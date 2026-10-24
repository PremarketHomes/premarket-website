import { NextResponse } from 'next/server';
import { adminDb } from '../../../firebase/adminApp';
import { verifyCron } from '../../middleware/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { computeAllPHI, computeConfidence, getWeights, segmentProperties } from '../../v1/phiScoring';
import { sendEmail } from '../../services/resendService';
import { wrapEmail } from '../../services/emailTemplates';
import OpenAI from 'openai';

export const maxDuration = 300;

const PHI_LABELS = {
  bdi: { name: 'Buyer Demand Index', hint: 'How much buyer interest exists (opinions, likes, serious enquiries)' },
  smi: { name: 'Seller Motivation Index', hint: 'How motivated sellers are to go to market (eagerness, timelines)' },
  pvi: { name: 'Price Validation Index', hint: 'How well asking prices align with buyer feedback and offers' },
  mhi: { name: 'Market Health Index', hint: 'Overall market health combining demand, supply, engagement and pricing' },
  evs: { name: 'Engagement Velocity Score', hint: 'Speed and depth of buyer engagement with listings' },
  bqi: { name: 'Buyer Quality Index', hint: 'Quality and seriousness of buyer enquiries (financial readiness, intent)' },
  fpi: { name: 'Future Pipeline Index', hint: 'Upcoming supply — how many sellers are preparing to list soon' },
  sdb: { name: 'Supply-Demand Balance', hint: 'Balance between available listings and active buyer demand' },
};

function scoreColor(score) {
  if (score >= 70) return '#10b981';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

function scoreLabel(score) {
  if (score >= 80) return 'Very Strong';
  if (score >= 60) return 'Strong';
  if (score >= 40) return 'Moderate';
  if (score >= 20) return 'Weak';
  return 'Very Weak';
}

function buildScoreBar(label, score, hint) {
  const color = scoreColor(score);
  const width = Math.max(score, 2);
  return `
  <tr><td style="padding:8px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="width:140px; padding-right:12px;">
          <p style="margin:0; font-size:13px; font-weight:600; color:#1a1a2e;">${label}</p>
          <p style="margin:2px 0 0 0; font-size:10px; color:#94a3b8;">${hint}</p>
        </td>
        <td>
          <div style="background:#f1f5f9; border-radius:6px; height:22px; overflow:hidden; position:relative;">
            <div style="background:${color}; height:22px; width:${width}%; border-radius:6px; min-width:24px;"></div>
          </div>
        </td>
        <td style="width:70px; text-align:right;">
          <span style="font-size:16px; font-weight:800; color:${color};">${Math.round(score)}</span>
          <span style="font-size:10px; color:#94a3b8;">/100</span>
        </td>
      </tr>
    </table>
  </td></tr>`;
}

/**
 * Daily cron: generates an AI market health report card from PHI metrics
 * and sends it to configured recipients.
 */
export async function GET(request) {
  const auth = verifyCron(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    // Get recipients from settings + users with marketReportOptIn
    const [settingsDoc, optInSnap] = await Promise.all([
      adminDb.collection('settings').doc('invoicing').get(),
      adminDb.collection('users').where('marketReportOptIn', '==', true).get(),
    ]);

    const settingsRecipients = settingsDoc.exists ? (settingsDoc.data().marketReportRecipients || []) : [];
    const optInEmails = optInSnap.docs.map(d => d.data().email).filter(Boolean);

    // Merge and deduplicate
    const recipients = [...new Set([...settingsRecipients, ...optInEmails].map(e => e.toLowerCase()))];

    if (recipients.length === 0) {
      return NextResponse.json({ success: true, skipped: true, reason: 'No recipients configured' });
    }

    // Gather platform-wide data
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [propertiesSnap, offersSnap, likesSnap, engagementSnap] = await Promise.all([
      adminDb.collection('properties').where('active', '==', true).get(),
      adminDb.collection('offers').where('createdAt', '>=', Timestamp.fromDate(thirtyDaysAgo)).get(),
      adminDb.collection('likes').where('createdAt', '>=', Timestamp.fromDate(thirtyDaysAgo)).get(),
      adminDb.collection('propertyEngagement').where('timestamp', '>=', Timestamp.fromDate(thirtyDaysAgo)).get(),
    ]);

    const properties = propertiesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const offers = offersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const likes = likesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const engagement = engagementSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Compute PHI scores
    const weights = await getWeights(adminDb);
    const { phi } = computeAllPHI(properties, offers, likes, engagement, weights);
    const confidence = computeConfidence(properties, offers, likes);
    const segments = segmentProperties(properties);

    // Platform stats
    const totalProperties = properties.length;
    const publicProperties = segments.premarket.length + segments.onMarket.length;
    const totalOffers = offers.length;
    const seriousOffers = offers.filter(o => o.serious === true).length;
    const totalLikes = likes.length;

    // Yesterday's activity
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const newPropsYesterday = properties.filter(p => {
      const ts = p.createdAt?.toDate?.() || (p.createdAt?.seconds ? new Date(p.createdAt.seconds * 1000) : null);
      return ts && ts >= yesterday && ts < today;
    }).length;

    const newOffersYesterday = offers.filter(o => {
      const ts = o.createdAt?.toDate?.() || (o.createdAt?.seconds ? new Date(o.createdAt.seconds * 1000) : null);
      return ts && ts >= yesterday && ts < today;
    }).length;

    // Generate AI summary
    let aiSummary = '';
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const prompt = `You are a real estate market analyst for Premarket, an Australian pre-market property platform.

Based on these PHI (Premarket Health Indicators) scores, write a brief 3-4 sentence market health summary. Be direct, insightful, and actionable. Reference specific metrics only if notable (very high or very low). Use Australian English.

Scores (0-100 scale):
- Buyer Demand Index (BDI): ${Math.round(phi.bdi)} — buyer interest level
- Seller Motivation Index (SMI): ${Math.round(phi.smi)} — seller eagerness to list
- Price Validation Index (PVI): ${Math.round(phi.pvi)} — price alignment between buyers and sellers
- Market Health Index (MHI): ${Math.round(phi.mhi)} — overall market health
- Engagement Velocity Score (EVS): ${Math.round(phi.evs)} — speed of buyer engagement
- Buyer Quality Index (BQI): ${Math.round(phi.bqi)} — quality/seriousness of buyers
- Future Pipeline Index (FPI): ${Math.round(phi.fpi)} — upcoming supply pipeline
- Supply-Demand Balance (SDB): ${Math.round(phi.sdb)} — supply vs demand ratio

Platform stats (last 30 days):
- ${totalProperties} active properties (${publicProperties} public)
- ${totalOffers} buyer opinions (${seriousOffers} serious)
- ${totalLikes} likes
- ${newPropsYesterday} new properties yesterday
- ${newOffersYesterday} new opinions yesterday
- Data confidence: ${confidence.level} (${confidence.score}/100)

Write 3-4 sentences only. No headings, no bullet points.`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.7,
      });
      aiSummary = completion.choices[0]?.message?.content?.trim() || '';
    } catch (aiErr) {
      console.error('AI summary generation error:', aiErr);
      aiSummary = 'AI summary unavailable today.';
    }

    // Build email HTML
    const dateStr = new Date().toLocaleDateString('en-AU', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });

    const mhiScore = Math.round(phi.mhi);
    const mhiColor = scoreColor(mhiScore);

    const bodyHTML = `
      <div style="text-align:center; margin-bottom:24px;">
        <p style="margin:0 0 4px 0; font-size:13px; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px;">Daily Market Report</p>
        <h1 style="margin:0 0 8px 0; font-size:26px; font-weight:800; color:#1a1a2e;">${dateStr}</h1>
      </div>

      <!-- Overall MHI Score -->
      <div bgcolor="#1a1a2e" style="text-align:center; background-color:#1a1a2e; border-radius:16px; padding:28px; margin-bottom:24px;">
        <p style="margin:0 0 4px 0; font-size:12px; color:#94a3b8; text-transform:uppercase; letter-spacing:1px;">Overall Market Health</p>
        <p style="margin:0 0 4px 0; font-size:52px; font-weight:900; color:${mhiColor};">${mhiScore}</p>
        <p style="margin:0; font-size:14px; font-weight:600; color:${mhiColor};">${scoreLabel(mhiScore)}</p>
        <p style="margin:8px 0 0 0; font-size:11px; color:#64748b;">Data confidence: ${confidence.level} (${confidence.score}/100)</p>
      </div>

      <!-- AI Summary -->
      ${aiSummary ? `
      <div style="background:#f0f9ff; border-left:4px solid #3b82f6; border-radius:0 10px 10px 0; padding:16px 20px; margin-bottom:24px;">
        <p style="margin:0 0 6px 0; font-size:11px; font-weight:600; color:#3b82f6; text-transform:uppercase; letter-spacing:0.5px;">AI Market Summary</p>
        <p style="margin:0; font-size:14px; color:#334155; line-height:1.6;">${aiSummary}</p>
      </div>` : ''}

      <!-- Quick Stats -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
        <tr>
          <td style="width:25%; text-align:center; padding:12px 4px;">
            <p style="margin:0; font-size:22px; font-weight:800; color:#1a1a2e;">${totalProperties}</p>
            <p style="margin:2px 0 0 0; font-size:11px; color:#94a3b8;">Active Listings</p>
          </td>
          <td style="width:25%; text-align:center; padding:12px 4px;">
            <p style="margin:0; font-size:22px; font-weight:800; color:#f97316;">${totalOffers}</p>
            <p style="margin:2px 0 0 0; font-size:11px; color:#94a3b8;">Opinions (30d)</p>
          </td>
          <td style="width:25%; text-align:center; padding:12px 4px;">
            <p style="margin:0; font-size:22px; font-weight:800; color:#10b981;">${seriousOffers}</p>
            <p style="margin:2px 0 0 0; font-size:11px; color:#94a3b8;">Serious Buyers</p>
          </td>
          <td style="width:25%; text-align:center; padding:12px 4px;">
            <p style="margin:0; font-size:22px; font-weight:800; color:#8b5cf6;">${totalLikes}</p>
            <p style="margin:2px 0 0 0; font-size:11px; color:#94a3b8;">Likes (30d)</p>
          </td>
        </tr>
      </table>

      ${(newPropsYesterday > 0 || newOffersYesterday > 0) ? `
      <div style="background:#f8fafc; border-radius:10px; padding:14px 18px; margin-bottom:24px;">
        <p style="margin:0; font-size:12px; color:#64748b;">
          <strong>Yesterday:</strong> ${newPropsYesterday} new propert${newPropsYesterday === 1 ? 'y' : 'ies'}, ${newOffersYesterday} new opinion${newOffersYesterday === 1 ? '' : 's'}
        </p>
      </div>` : ''}

      <!-- All 8 PHI Scores -->
      <h2 style="margin:0 0 16px 0; font-size:16px; font-weight:700; color:#1a1a2e;">PHI Scorecard</h2>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
        ${Object.entries(PHI_LABELS).map(([key, { name, hint }]) =>
          buildScoreBar(name, phi[key] || 0, hint)
        ).join('')}
      </table>

      <!-- What These Mean -->
      <div style="background:#fefce8; border-radius:10px; padding:16px 18px; margin-bottom:16px;">
        <p style="margin:0 0 8px 0; font-size:12px; font-weight:600; color:#a16207;">How to read this report</p>
        <p style="margin:0; font-size:12px; color:#78716c; line-height:1.6;">
          Scores range from 0-100. <span style="color:#10b981; font-weight:600;">Green (70+)</span> = strong,
          <span style="color:#f59e0b; font-weight:600;">Amber (40-69)</span> = moderate,
          <span style="color:#ef4444; font-weight:600;">Red (&lt;40)</span> = needs attention.
          The Market Health Index (MHI) is the headline score combining demand, supply, engagement and pricing.
        </p>
      </div>

      ${confidence.warnings?.length > 0 ? `
      <div style="background:#fef2f2; border-radius:10px; padding:14px 18px; margin-bottom:16px;">
        <p style="margin:0 0 6px 0; font-size:12px; font-weight:600; color:#dc2626;">Data Warnings</p>
        ${confidence.warnings.map(w => `<p style="margin:0 0 4px 0; font-size:12px; color:#991b1b;">${w}</p>`).join('')}
      </div>` : ''}
    `;

    const html = wrapEmail({
      previewText: `Market Health: ${mhiScore}/100 ${scoreLabel(mhiScore)} — ${dateStr}`,
      bodyHTML,
      recipientEmail: recipients[0],
      reason: "You're receiving this daily report because you're on the market report recipients list.",
    });

    // Send to all recipients
    let sent = 0;
    let errors = 0;
    const errorDetails = [];
    for (const email of recipients) {
      try {
        const result = await sendEmail({
          to: email,
          subject: `Market Health Report — ${mhiScore}/100 ${scoreLabel(mhiScore)}`,
          html,
        });
        // Resend returns { data, error } — check for error
        if (result?.error) {
          console.error(`Resend error for ${email}:`, result.error);
          errorDetails.push({ email, error: result.error?.message || JSON.stringify(result.error) });
          errors++;
        } else {
          sent++;
        }
      } catch (err) {
        console.error(`Failed to send report to ${email}:`, err);
        errorDetails.push({ email, error: err.message });
        errors++;
      }
    }

    return NextResponse.json({
      success: true,
      sent,
      errors,
      errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
      recipients,
      mhi: mhiScore,
      confidence: confidence.level,
    });
  } catch (err) {
    console.error('Market report cron error:', err);
    return NextResponse.json({ error: 'Market report failed', details: err.message }, { status: 500 });
  }
}

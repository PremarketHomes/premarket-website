import { resolveBuyerIdentity, profileForRegistration } from '../../utils/registrationIdentity';
import { adminDb } from '../../firebase/adminApp';
import { sendEmail } from './resendService';
import { wrapEmail } from './emailTemplates';
import PDFDocument from 'pdfkit';

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function fmtMoney(v) {
  if (!v) return '$0';
  return '$' + Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtFinance(type) {
  if (!type) return '--';
  const map = { cash: 'Cash', approved_finance: 'Approved Finance', pre_approval: 'Pre-Approval', not_yet: 'Not Yet' };
  return map[type] || type;
}

function fmtSeriousness(level) {
  if (!level) return '--';
  const map = { just_browsing: 'Just Browsing', interested: 'Interested', very_interested: 'Very Interested', ready_to_buy: 'Ready to Buy' };
  return map[level] || level;
}

function fmtBudget(val) {
  if (!val) return null;
  if (val >= 1000000) return `$${(val / 1000000).toFixed(val % 1000000 === 0 ? 0 : 1)}M`;
  if (val >= 1000) return `$${Math.round(val / 1000)}K`;
  return fmtMoney(val);
}

function fmtTimestamp(ts) {
  if (!ts) return '--';
  const d = ts.toDate ? ts.toDate() : (ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts));
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function buildPriceDistribution(opinions, bucketCount = 5) {
  const amounts = opinions.map(o => o.offerAmount || 0).filter(a => a > 0);
  if (!amounts.length) return [];
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  if (min === max) return [{ label: fmtMoney(min), count: amounts.length, pct: 100 }];
  const step = (max - min) / bucketCount;
  const buckets = [];
  for (let i = 0; i < bucketCount; i++) {
    const lo = min + step * i;
    const hi = i === bucketCount - 1 ? max + 1 : min + step * (i + 1);
    const count = amounts.filter(a => a >= lo && a < hi).length;
    buckets.push({
      label: `${fmtMoney(lo)} – ${fmtMoney(i === bucketCount - 1 ? max : hi)}`,
      count,
      pct: amounts.length > 0 ? Math.round((count / amounts.length) * 100) : 0,
    });
  }
  return buckets;
}

export async function buildReport(propertyId) {
  const propertySnap = await adminDb.collection('properties').doc(propertyId).get();
  if (!propertySnap.exists) throw new Error('Property not found');
  const property = { id: propertySnap.id, ...propertySnap.data() };

  const [offersSnap, likesSnap] = await Promise.all([
    adminDb.collection('offers').where('propertyId', '==', propertyId).where('type', '==', 'opinion').get(),
    adminDb.collection('likes').where('propertyId', '==', propertyId).get(),
  ]);

  const serious = [];
  const passive = [];
  const allOpinions = [];
  for (const d of offersSnap.docs) {
    const data = d.data();
    allOpinions.push(data);
    if (data.serious === true) serious.push(data);
    else passive.push(data);
  }

  // Batch-fetch user docs for serious buyers with userId
  const seriousUserIds = [...new Set(serious.filter(o => o.userId).map(o => o.userId))];
  const userMap = {};
  if (seriousUserIds.length > 0) {
    const chunks = [];
    for (let i = 0; i < seriousUserIds.length; i += 10) {
      chunks.push(seriousUserIds.slice(i, i + 10));
    }
    for (const chunk of chunks) {
      const userSnaps = await Promise.all(chunk.map(uid => adminDb.collection('users').doc(uid).get()));
      userSnaps.forEach(snap => {
        if (snap.exists) userMap[snap.id] = snap.data();
      });
    }
  }

  // Build serious buyer details with all registration data.
  // Prefer linked user profile; fall back to contact info captured directly on
  // the offer (e.g. iPad kiosk / web "register interest" flow).
  const seriousBuyerDetails = serious.map(o => {
    const u = o.userId ? userMap[o.userId] : null;
    // Typed registration details win; the linked account only fills gaps and
    // only if it can be the same person (see utils/registrationIdentity.js).
    const identity = resolveBuyerIdentity(o, u);
    const prefs = profileForRegistration(o, u)?.buyerPreferences || {};
    return {
      name: identity.name || 'Anonymous',
      email: identity.email,
      phone: identity.phone,
      price: o.offerAmount || 0,
      buyerType: o.buyerType || null,
      seriousness: o.seriousnessLevel || null,
      isFirstHomeBuyer: !!o.isFirstHomeBuyer,
      isInvestor: !!o.isInvestor,
      createdAt: o.createdAt || null,
      preferredLocations: prefs.locations || [],
      preferredType: prefs.propertyType || null,
      minBedrooms: prefs.minBedrooms || null,
      minBudget: prefs.minBudget || null,
      maxBudget: prefs.maxBudget || null,
    };
  });

  const seriousMedian = median(serious.map((o) => o.offerAmount || 0));
  const passiveMedian = median(passive.map((o) => o.offerAmount || 0));
  const combinedMedian = median([
    ...serious.map((o) => o.offerAmount || 0),
    ...passive.map((o) => o.offerAmount || 0),
  ]);

  // Buyer breakdown
  const fhbCount = allOpinions.filter(o => o.isFirstHomeBuyer).length;
  const investorCount = allOpinions.filter(o => o.isInvestor).length;

  // Price range
  const allAmounts = allOpinions.map(o => o.offerAmount || 0).filter(a => a > 0);
  const priceMin = allAmounts.length ? Math.min(...allAmounts) : 0;
  const priceMax = allAmounts.length ? Math.max(...allAmounts) : 0;

  // Price distribution buckets
  const priceDistribution = buildPriceDistribution(allOpinions);

  // Listing vs median percentage
  const listingNum = parseFloat(String(property.price || '0').replace(/[^0-9.]/g, '')) || 0;
  const listingVsMedianPct = listingNum && combinedMedian
    ? Math.round(((combinedMedian - listingNum) / listingNum) * 100)
    : null;

  return {
    property,
    seriousCount: serious.length,
    passiveCount: passive.length,
    seriousMedian,
    passiveMedian,
    combinedMedian,
    likesCount: likesSnap.size,
    fhbCount,
    investorCount,
    priceMin,
    priceMax,
    priceDistribution,
    listingVsMedianPct,
    seriousBuyerDetails,
    allOpinions,
  };
}

async function generateReportPDF(report) {
  const title = report.property.title || 'Untitled Property';
  const address = report.property.formattedAddress || report.property.address || '';
  const listingPrice = report.property.price;

  let confidence = { label: 'Low' };
  if (report.seriousCount > 1) confidence = { label: 'High' };
  else if (report.seriousCount === 1) confidence = { label: 'Medium' };

  // Fetch logo
  let logoBuffer;
  try {
    const logoRes = await fetch('https://premarketvideos.b-cdn.net/assets/logo.png');
    if (logoRes.ok) logoBuffer = Buffer.from(await logoRes.arrayBuffer());
  } catch { /* skip logo if fetch fails */ }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const orange = '#E97316';
    const dark = '#1E293B';
    const grey = '#64748B';
    const pageWidth = doc.page.width - 100; // margins

    // --- Logo ---
    if (logoBuffer) {
      doc.image(logoBuffer, 50, 40, { width: 140 });
      doc.moveDown(3);
    }

    // --- Divider ---
    doc.moveTo(50, doc.y).lineTo(50 + pageWidth, doc.y).strokeColor(orange).lineWidth(2).stroke();
    doc.moveDown(1);

    // --- Title ---
    doc.fontSize(22).fillColor(dark).text(title, { align: 'left' });
    if (address) {
      doc.fontSize(11).fillColor(grey).text(address);
    }
    doc.moveDown(0.5);

    // --- Listing Price ---
    if (listingPrice) {
      doc.fontSize(10).fillColor(grey).text('Listing Price');
      doc.fontSize(18).fillColor(dark).text(fmtMoney(parseFloat(String(listingPrice).replace(/[^0-9.]/g, '')) || 0));
      doc.moveDown(0.5);
    }

    // --- Confidence Score ---
    doc.fontSize(10).fillColor(grey).text('Confidence Score');
    doc.fontSize(16).fillColor(orange).text(confidence.label);
    doc.moveDown(1);

    // --- Section: Engagement ---
    doc.fontSize(14).fillColor(dark).text('Engagement Overview');
    doc.moveTo(50, doc.y + 2).lineTo(50 + pageWidth, doc.y + 2).strokeColor('#E2E8F0').lineWidth(1).stroke();
    doc.moveDown(0.5);

    const views = report.property.stats?.views || 0;
    const totalBuyers = report.seriousCount + report.passiveCount;
    doc.fontSize(10).fillColor(grey);
    doc.text(`Total Views: ${views}          Price Opinions: ${totalBuyers}          Serious Buyers: ${report.seriousCount}          Likes: ${report.likesCount}`);
    doc.moveDown(1);

    // --- Listing vs Median ---
    if (report.listingVsMedianPct !== null) {
      doc.fontSize(14).fillColor(dark).text('Listing vs Median Comparison');
      doc.moveTo(50, doc.y + 2).lineTo(50 + pageWidth, doc.y + 2).strokeColor('#E2E8F0').lineWidth(1).stroke();
      doc.moveDown(0.5);
      const direction = report.listingVsMedianPct >= 0 ? 'above' : 'below';
      doc.fontSize(10).fillColor(grey);
      doc.text(`Buyer median is ${Math.abs(report.listingVsMedianPct)}% ${direction} listing price`);
      doc.moveDown(1);
    }

    // --- Price Range ---
    if (report.priceMin > 0) {
      doc.fontSize(14).fillColor(dark).text('Price Range');
      doc.moveTo(50, doc.y + 2).lineTo(50 + pageWidth, doc.y + 2).strokeColor('#E2E8F0').lineWidth(1).stroke();
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor(grey);
      doc.text(`Lowest: ${fmtMoney(report.priceMin)}          Highest: ${fmtMoney(report.priceMax)}`);
      doc.moveDown(1);
    }

    // --- Section: Price Intelligence ---
    doc.fontSize(14).fillColor(dark).text('Price Intelligence');
    doc.moveTo(50, doc.y + 2).lineTo(50 + pageWidth, doc.y + 2).strokeColor('#E2E8F0').lineWidth(1).stroke();
    doc.moveDown(0.5);

    // Table
    const tableTop = doc.y;
    const col1 = 50;
    const col2 = 250;
    const col3 = 380;
    const rowH = 28;

    // Header
    doc.fontSize(9).fillColor(grey);
    doc.text('Category', col1, tableTop);
    doc.text('Count', col2, tableTop);
    doc.text('Median Price', col3, tableTop);

    // Row 1 - Serious
    const r1 = tableTop + rowH;
    doc.rect(col1, r1 - 4, pageWidth, rowH).fillColor('#F8FAFC').fill();
    doc.fontSize(10).fillColor(dark);
    doc.text('Serious Buyers', col1 + 8, r1 + 4);
    doc.text(String(report.seriousCount), col2, r1 + 4);
    doc.text(fmtMoney(report.seriousMedian), col3, r1 + 4);

    // Row 2 - Passive
    const r2 = r1 + rowH;
    doc.fontSize(10).fillColor(dark);
    doc.text('Passive Buyers', col1 + 8, r2 + 4);
    doc.text(String(report.passiveCount), col2, r2 + 4);
    doc.text(fmtMoney(report.passiveMedian), col3, r2 + 4);

    // Row 3 - Combined
    const r3 = r2 + rowH;
    doc.rect(col1, r3 - 4, pageWidth, rowH).fillColor('#F8FAFC').fill();
    doc.fontSize(10).fillColor(dark).font('Helvetica-Bold');
    doc.text('Combined', col1 + 8, r3 + 4);
    doc.text(String(totalBuyers), col2, r3 + 4);
    doc.text(fmtMoney(report.combinedMedian), col3, r3 + 4);
    doc.font('Helvetica');

    doc.y = r3 + rowH + 16;

    // --- Buyer Breakdown ---
    if (report.fhbCount > 0 || report.investorCount > 0) {
      doc.fontSize(14).fillColor(dark).text('Buyer Breakdown');
      doc.moveTo(50, doc.y + 2).lineTo(50 + pageWidth, doc.y + 2).strokeColor('#E2E8F0').lineWidth(1).stroke();
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor(grey);
      doc.text(`First Home Buyers: ${report.fhbCount}          Investors: ${report.investorCount}`);
      doc.moveDown(1);
    }

    // --- Serious Buyer Details ---
    if (report.seriousBuyerDetails && report.seriousBuyerDetails.length > 0) {
      if (doc.y > doc.page.height - 200) doc.addPage();

      doc.fontSize(14).fillColor(dark).text('Serious Buyer Details');
      doc.moveTo(50, doc.y + 2).lineTo(50 + pageWidth, doc.y + 2).strokeColor('#E2E8F0').lineWidth(1).stroke();
      doc.moveDown(0.5);

      report.seriousBuyerDetails.forEach((b) => {
        const cardH = 70;
        if (doc.y > doc.page.height - cardH - 40) doc.addPage();

        const cardTop = doc.y;
        // Background
        doc.rect(50, cardTop, pageWidth, cardH).fillColor('#F8FAFC').fill();
        doc.rect(50, cardTop, pageWidth, cardH).strokeColor('#E2E8F0').lineWidth(0.5).stroke();

        // Name + contact (left)
        doc.fontSize(11).fillColor(dark).font('Helvetica-Bold');
        doc.text(b.name, 58, cardTop + 8, { width: 250 });
        doc.font('Helvetica').fontSize(8).fillColor(grey);
        const contactParts = [b.email, b.phone].filter(Boolean);
        if (contactParts.length) {
          doc.text(contactParts.join('  |  '), 58, cardTop + 22, { width: 250 });
        }

        // Price + date (right)
        doc.fontSize(14).fillColor(dark).font('Helvetica-Bold');
        doc.text(fmtMoney(b.price), 350, cardTop + 8, { width: 190, align: 'right' });
        doc.font('Helvetica').fontSize(8).fillColor(grey);
        doc.text(fmtTimestamp(b.createdAt), 350, cardTop + 24, { width: 190, align: 'right' });

        // Row 2: Finance, Interest, Badges
        const row2Y = cardTop + 40;
        doc.fontSize(8).fillColor(grey);
        doc.text(`Finance: `, 58, row2Y);
        doc.fillColor(dark).text(fmtFinance(b.buyerType), 100, row2Y);

        doc.fillColor(grey).text(`Interest: `, 200, row2Y);
        doc.fillColor(dark).text(fmtSeriousness(b.seriousness), 242, row2Y);

        const badges = [];
        if (b.isFirstHomeBuyer) badges.push('FHB');
        if (b.isInvestor) badges.push('Investor');
        if (badges.length) {
          doc.fillColor(grey).text(badges.join(', '), 370, row2Y);
        }

        // Row 3: Preferences (if any)
        const budgetStr = (b.minBudget || b.maxBudget) ? `${fmtBudget(b.minBudget) || 'Any'} – ${fmtBudget(b.maxBudget) || 'Any'}` : null;
        const prefsItems = [
          b.preferredLocations.length ? `Locations: ${b.preferredLocations.join(', ')}` : null,
          b.preferredType ? `Type: ${b.preferredType}` : null,
          b.minBedrooms ? `Min Beds: ${b.minBedrooms}+` : null,
          budgetStr ? `Budget: ${budgetStr}` : null,
        ].filter(Boolean);

        if (prefsItems.length) {
          doc.fontSize(7).fillColor(grey).text(prefsItems.join('  |  '), 58, row2Y + 14, { width: pageWidth - 16 });
        }

        doc.y = cardTop + cardH + 8;
      });

      doc.moveDown(0.5);
    }

    // --- Opinion Timeline Chart ---
    const opinionsWithDate = (report.allOpinions || []).filter(o => {
      if (!o.createdAt || !(o.offerAmount > 0)) return false;
      const d = o.createdAt.toDate ? o.createdAt.toDate() : (o.createdAt._seconds ? new Date(o.createdAt._seconds * 1000) : new Date(o.createdAt));
      return !isNaN(d.getTime());
    });

    if (opinionsWithDate.length >= 2) {
      if (doc.y > doc.page.height - 250) doc.addPage();

      doc.fontSize(14).fillColor(dark).text('Price Opinion Timeline');
      doc.moveTo(50, doc.y + 2).lineTo(50 + pageWidth, doc.y + 2).strokeColor('#E2E8F0').lineWidth(1).stroke();
      doc.moveDown(0.5);

      const chartX = 90, chartW = pageWidth - 60, chartH = 150;
      const chartY = doc.y;

      // Parse dates and sort
      const points = opinionsWithDate.map(o => {
        const d = o.createdAt.toDate ? o.createdAt.toDate() : (o.createdAt._seconds ? new Date(o.createdAt._seconds * 1000) : new Date(o.createdAt));
        return { date: d, price: o.offerAmount, serious: !!o.serious };
      }).sort((a, b) => a.date - b.date);

      const minTime = points[0].date.getTime();
      const maxTime = points[points.length - 1].date.getTime();
      const timeRange = maxTime - minTime || 1;
      const prices = points.map(p => p.price);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const priceRange = maxPrice - minPrice || 1;

      // Draw axes
      doc.strokeColor('#CBD5E1').lineWidth(1);
      doc.moveTo(chartX, chartY).lineTo(chartX, chartY + chartH).stroke();
      doc.moveTo(chartX, chartY + chartH).lineTo(chartX + chartW, chartY + chartH).stroke();

      // Y-axis labels (4 levels)
      doc.fontSize(7).fillColor(grey);
      for (let i = 0; i <= 3; i++) {
        const yVal = minPrice + (priceRange * (3 - i)) / 3;
        const yPos = chartY + (chartH * i) / 3;
        doc.text(fmtMoney(yVal), 50, yPos - 4, { width: 36, align: 'right' });
        if (i > 0) {
          doc.strokeColor('#F1F5F9').moveTo(chartX, yPos).lineTo(chartX + chartW, yPos).stroke();
        }
      }

      // Plot points and connecting line
      const plotPoints = points.map(p => ({
        x: chartX + ((p.date.getTime() - minTime) / timeRange) * chartW,
        y: chartY + chartH - ((p.price - minPrice) / priceRange) * chartH,
        serious: p.serious,
      }));

      // Line
      doc.strokeColor('#94A3B8').lineWidth(1);
      plotPoints.forEach((pt, i) => {
        if (i === 0) doc.moveTo(pt.x, pt.y);
        else doc.lineTo(pt.x, pt.y);
      });
      doc.stroke();

      // Dots
      plotPoints.forEach(pt => {
        const radius = pt.serious ? 4 : 3;
        const color = pt.serious ? dark : orange;
        doc.circle(pt.x, pt.y, radius).fillColor(color).fill();
      });

      // Legend
      const legendY = chartY + chartH + 16;
      doc.circle(chartX, legendY, 4).fillColor(dark).fill();
      doc.fontSize(8).fillColor(grey).text('Serious', chartX + 8, legendY - 4);
      doc.circle(chartX + 70, legendY, 3).fillColor(orange).fill();
      doc.text('Passive', chartX + 78, legendY - 4);

      doc.y = legendY + 20;
    }

    // --- Footer ---
    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(50 + pageWidth, doc.y).strokeColor('#E2E8F0').lineWidth(1).stroke();
    doc.moveDown(0.5);
    doc.fontSize(8).fillColor(grey).text(
      'This report is generated by Premarket to help sellers and buyers make better, more confident decisions.',
      { align: 'center' }
    );
    doc.fontSize(8).text(`Report generated on ${new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}`, { align: 'center' });

    doc.end();
  });
}

export async function gatherReport(email, propertyId, name) {
  const report = await buildReport(propertyId);

  let confidence = { label: 'Low', color: '#EF4444' };
  if (report.seriousCount > 1) confidence = { label: 'High', color: '#22C55E' };
  else if (report.seriousCount === 1) confidence = { label: 'Medium', color: '#F97316' };

  const imgUrl = report.property.imageUrls?.[0] || '';
  const title = report.property.title || 'Untitled Property';
  const address = report.property.address || '';
  const greeting = name || report.property.clientName || 'there';
  const views = report.property.stats?.views || 0;
  const totalBuyers = report.seriousCount + report.passiveCount;
  const listingNum = parseFloat(String(report.property.price || '0').replace(/[^0-9.]/g, '')) || 0;

  // Build price distribution HTML
  const distHtml = report.priceDistribution.length > 0
    ? report.priceDistribution.map(b => `
      <tr>
        <td style="padding:6px 10px; font-size:13px; color:#333; white-space:nowrap;">${b.label}</td>
        <td style="padding:6px 10px; width:60%;">
          <div style="background:#F1F5F9; border-radius:4px; height:20px; width:100%;">
            <div style="background:#F97316; border-radius:4px; height:20px; width:${Math.max(b.pct, 2)}%; min-width:2px;"></div>
          </div>
        </td>
        <td style="padding:6px 10px; font-size:13px; color:#666; text-align:right; white-space:nowrap;">${b.count} (${b.pct}%)</td>
      </tr>
    `).join('')
    : '';

  // Listing vs median section
  let listingVsMedianHtml = '';
  if (report.listingVsMedianPct !== null) {
    const direction = report.listingVsMedianPct >= 0 ? 'above' : 'below';
    const dirColor = report.listingVsMedianPct >= 0 ? '#22C55E' : '#EF4444';
    listingVsMedianHtml = `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
        <tr>
          <td style="padding:16px; background:#F8FAFC; border-radius:8px; border:1px solid #E2E8F0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="text-align:center; padding:8px;">
                  <div style="font-size:12px; color:#64748B; margin-bottom:4px;">Listing Price</div>
                  <div style="font-size:20px; font-weight:bold; color:#1E293B;">${fmtMoney(listingNum)}</div>
                </td>
                <td style="text-align:center; padding:8px; font-size:24px; color:#94A3B8;">→</td>
                <td style="text-align:center; padding:8px;">
                  <div style="font-size:12px; color:#64748B; margin-bottom:4px;">Combined Median</div>
                  <div style="font-size:20px; font-weight:bold; color:#1E293B;">${fmtMoney(report.combinedMedian)}</div>
                </td>
                <td style="text-align:center; padding:8px;">
                  <div style="font-size:12px; color:#64748B; margin-bottom:4px;">Difference</div>
                  <div style="font-size:20px; font-weight:bold; color:${dirColor};">${report.listingVsMedianPct >= 0 ? '+' : ''}${report.listingVsMedianPct}%</div>
                  <div style="font-size:11px; color:${dirColor};">${direction} listing</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`;
  }

  // Generate PDF
  const pdfBuffer = await generateReportPDF(report);

  const reportBody = `
    <div style="font-family:Arial, Helvetica, sans-serif; color:#333;">
      <p style="font-size:14px; color:#555;">Hi ${greeting},</p>
      <p style="font-size:14px; color:#555;">I've used the power of <strong>Premarket</strong> to promote your property to investors and buyers and gather their price opinions. We've then segmented those buyers into two groups:</p>
      <ul style="font-size:14px; color:#555; margin:10px 0 20px 20px; padding:0;">
        <li><strong>Passive buyers</strong> – property enthusiasts who like to give their opinions and feedback.</li>
        <li><strong>Serious buyers</strong> – buyers who have expressed genuine interest in your property and will be the first people we contact if you choose to work with us.</li>
      </ul>
      <p style="font-size:14px; color:#555;">Here's your private Premarket insight report:</p>
      <h2 style="margin:20px 0 10px; color:#111;">${title}</h2>
      <p style="margin:0 0 20px; font-size:14px; color:#777;">${address}</p>
      ${imgUrl ? `<img src="${imgUrl}" alt="Property" style="max-width:100%; border-radius:10px; margin-bottom:20px;"/>` : ''}

      <!-- Engagement Overview -->
      <h3 style="margin-top:24px; color:#111; font-size:16px;">Engagement Overview</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 20px;">
        <tr>
          <td style="padding:12px; text-align:center; background:#F8FAFC; border-radius:8px 0 0 8px; border:1px solid #E2E8F0;">
            <div style="font-size:22px; font-weight:bold; color:#1E293B;">${views}</div>
            <div style="font-size:11px; color:#64748B; margin-top:2px;">Views</div>
          </td>
          <td style="padding:12px; text-align:center; background:#F8FAFC; border:1px solid #E2E8F0; border-left:none;">
            <div style="font-size:22px; font-weight:bold; color:#1E293B;">${totalBuyers}</div>
            <div style="font-size:11px; color:#64748B; margin-top:2px;">Opinions</div>
          </td>
          <td style="padding:12px; text-align:center; background:#F8FAFC; border:1px solid #E2E8F0; border-left:none;">
            <div style="font-size:22px; font-weight:bold; color:#1E293B;">${report.seriousCount}</div>
            <div style="font-size:11px; color:#64748B; margin-top:2px;">Serious</div>
          </td>
          <td style="padding:12px; text-align:center; background:#F8FAFC; border-radius:0 8px 8px 0; border:1px solid #E2E8F0; border-left:none;">
            <div style="font-size:22px; font-weight:bold; color:#1E293B;">${report.likesCount}</div>
            <div style="font-size:11px; color:#64748B; margin-top:2px;">Likes</div>
          </td>
        </tr>
      </table>

      <h3 style="margin-top:20px; color:#111;">Confidence Score: <span style="color:${confidence.color};">${confidence.label}</span></h3>

      ${listingVsMedianHtml}

      <!-- Three Median Cards -->
      <h3 style="margin-top:24px; color:#111; font-size:16px;">Median Price Opinions</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 20px;">
        <tr>
          <td style="padding:12px; text-align:center; background:#FFF7ED; border-radius:8px 0 0 8px; border:1px solid #FED7AA;">
            <div style="font-size:11px; color:#9A3412; margin-bottom:4px;">Serious Buyers</div>
            <div style="font-size:18px; font-weight:bold; color:#1E293B;">${fmtMoney(report.seriousMedian)}</div>
          </td>
          <td style="padding:12px; text-align:center; background:#F8FAFC; border:1px solid #E2E8F0; border-left:none;">
            <div style="font-size:11px; color:#64748B; margin-bottom:4px;">Passive Buyers</div>
            <div style="font-size:18px; font-weight:bold; color:#1E293B;">${fmtMoney(report.passiveMedian)}</div>
          </td>
          <td style="padding:12px; text-align:center; background:#F8FAFC; border-radius:0 8px 8px 0; border:1px solid #E2E8F0; border-left:none;">
            <div style="font-size:11px; color:#64748B; margin-bottom:4px;">Combined</div>
            <div style="font-size:18px; font-weight:bold; color:#1E293B;">${fmtMoney(report.combinedMedian)}</div>
          </td>
        </tr>
      </table>

      <!-- Price Range -->
      ${report.priceMin > 0 ? `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 20px;">
        <tr>
          <td style="padding:12px; background:#F8FAFC; border-radius:8px; border:1px solid #E2E8F0;">
            <div style="font-size:12px; color:#64748B; margin-bottom:4px;">Price Range</div>
            <div style="font-size:16px; font-weight:bold; color:#1E293B;">${fmtMoney(report.priceMin)} – ${fmtMoney(report.priceMax)}</div>
          </td>
        </tr>
      </table>
      ` : ''}

      <!-- Price Distribution -->
      ${distHtml ? `
      <h3 style="margin-top:24px; color:#111; font-size:16px;">Price Distribution</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 20px; border:1px solid #E2E8F0; border-radius:8px; overflow:hidden;">
        ${distHtml}
      </table>
      ` : ''}

      <!-- Buyer Breakdown -->
      <h3 style="margin-top:24px; color:#111; font-size:16px;">Buyer Breakdown</h3>
      <table width="100%" cellpadding="6" cellspacing="0" style="border-collapse:collapse; font-size:14px; margin-top:10px; border:1px solid #E2E8F0; border-radius:8px;">
        <tr style="background:#F8FAFC;">
          <td style="padding:10px 14px; color:#64748B; font-size:12px;">Serious Buyers</td>
          <td style="padding:10px 14px; font-weight:bold; color:#1E293B;">${report.seriousCount}</td>
          <td style="padding:10px 14px; color:#64748B; font-size:12px;">Passive Buyers</td>
          <td style="padding:10px 14px; font-weight:bold; color:#1E293B;">${report.passiveCount}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px; color:#64748B; font-size:12px;">First Home Buyers</td>
          <td style="padding:10px 14px; font-weight:bold; color:#1E293B;">${report.fhbCount}</td>
          <td style="padding:10px 14px; color:#64748B; font-size:12px;">Investors</td>
          <td style="padding:10px 14px; font-weight:bold; color:#1E293B;">${report.investorCount}</td>
        </tr>
      </table>

      <!-- Serious Buyer Details -->
      ${report.seriousBuyerDetails.length > 0 ? `
      <h3 style="margin-top:24px; color:#111; font-size:16px;">Serious Buyer Details</h3>
      ${report.seriousBuyerDetails.map((b) => {
        const badges = [b.isFirstHomeBuyer ? 'First Home Buyer' : null, b.isInvestor ? 'Investor' : null].filter(Boolean);
        const budgetStr = (b.minBudget || b.maxBudget) ? `${fmtBudget(b.minBudget) || 'Any'} – ${fmtBudget(b.maxBudget) || 'Any'}` : null;
        const prefsItems = [
          b.preferredLocations.length ? `Locations: ${b.preferredLocations.join(', ')}` : null,
          b.preferredType ? `Type: ${b.preferredType}` : null,
          b.minBedrooms ? `Min Beds: ${b.minBedrooms}+` : null,
          budgetStr ? `Budget: ${budgetStr}` : null,
        ].filter(Boolean);
        return `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0; border:1px solid #E2E8F0; border-radius:8px; overflow:hidden;">
          <tr style="background:#F8FAFC;">
            <td style="padding:12px 14px;">
              <div style="font-size:15px; font-weight:bold; color:#1E293B; margin-bottom:2px;">${b.name}</div>
              <div style="font-size:12px; color:#64748B;">
                ${b.email ? `${b.email}` : ''}${b.email && b.phone ? ' &middot; ' : ''}${b.phone ? `${b.phone}` : ''}
              </div>
            </td>
            <td style="padding:12px 14px; text-align:right; vertical-align:top;">
              <div style="font-size:18px; font-weight:bold; color:#1E293B;">${fmtMoney(b.price)}</div>
              <div style="font-size:11px; color:#64748B;">${fmtTimestamp(b.createdAt)}</div>
            </td>
          </tr>
          <tr>
            <td colspan="2" style="padding:8px 14px 12px;">
              <table cellpadding="0" cellspacing="0" style="font-size:12px;">
                <tr>
                  <td style="padding:2px 16px 2px 0; color:#64748B;">Finance:</td>
                  <td style="padding:2px 24px 2px 0; color:#1E293B; font-weight:600;">${fmtFinance(b.buyerType)}</td>
                  <td style="padding:2px 16px 2px 0; color:#64748B;">Interest:</td>
                  <td style="padding:2px 0; color:#1E293B; font-weight:600;">${fmtSeriousness(b.seriousness)}</td>
                </tr>
              </table>
              ${badges.length ? `<div style="margin-top:6px;">${badges.map(badge => `<span style="display:inline-block; padding:2px 8px; background:#F1F5F9; border-radius:4px; font-size:11px; color:#475569; margin-right:4px;">${badge}</span>`).join('')}</div>` : ''}
              ${prefsItems.length ? `<div style="margin-top:6px; padding-top:6px; border-top:1px solid #F1F5F9; font-size:11px; color:#64748B;">${prefsItems.join(' &middot; ')}</div>` : ''}
            </td>
          </tr>
        </table>`;
      }).join('')}
      ` : ''}

      <!-- Opinion Timeline -->
      ${(() => {
        const opinionsWithDate = report.allOpinions.filter(o => o.createdAt && (o.offerAmount || 0) > 0);
        if (opinionsWithDate.length < 2) return '';
        // Group by week
        const weeks = {};
        opinionsWithDate.forEach(o => {
          const d = o.createdAt.toDate ? o.createdAt.toDate() : (o.createdAt._seconds ? new Date(o.createdAt._seconds * 1000) : new Date(o.createdAt));
          if (isNaN(d.getTime())) return;
          const weekStart = new Date(d);
          weekStart.setDate(weekStart.getDate() - weekStart.getDay());
          const key = weekStart.toISOString().slice(0, 10);
          if (!weeks[key]) weeks[key] = { prices: [], serious: 0, passive: 0 };
          weeks[key].prices.push(o.offerAmount);
          if (o.serious) weeks[key].serious++; else weeks[key].passive++;
        });
        const sortedWeeks = Object.entries(weeks).sort(([a], [b]) => a.localeCompare(b));
        if (sortedWeeks.length < 1) return '';
        return `
        <h3 style="margin-top:24px; color:#111; font-size:16px;">Opinion Timeline</h3>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; font-size:13px; margin-top:10px; border:1px solid #E2E8F0; border-radius:8px;">
          <tr style="background:#F8FAFC;">
            <td style="padding:8px 12px; color:#64748B; font-size:11px; font-weight:bold;">Week of</td>
            <td style="padding:8px 12px; color:#64748B; font-size:11px; font-weight:bold;">Opinions</td>
            <td style="padding:8px 12px; color:#64748B; font-size:11px; font-weight:bold;">Avg Price</td>
            <td style="padding:8px 12px; color:#64748B; font-size:11px; font-weight:bold;">Serious</td>
            <td style="padding:8px 12px; color:#64748B; font-size:11px; font-weight:bold;">Passive</td>
          </tr>
          ${sortedWeeks.map(([weekKey, data]) => {
            const avg = Math.round(data.prices.reduce((s, p) => s + p, 0) / data.prices.length);
            const weekDate = new Date(weekKey);
            const label = weekDate.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
            return `
          <tr>
            <td style="padding:8px 12px; color:#1E293B;">${label}</td>
            <td style="padding:8px 12px; color:#1E293B;">${data.prices.length}</td>
            <td style="padding:8px 12px; color:#1E293B; font-weight:600;">${fmtMoney(avg)}</td>
            <td style="padding:8px 12px; color:#1E293B;">${data.serious}</td>
            <td style="padding:8px 12px; color:#64748B;">${data.passive}</td>
          </tr>`;
          }).join('')}
        </table>`;
      })()}

      <p style="margin-top:30px; font-size:12px; color:#777;">This report is powered by Premarket to help sellers and buyers make better, more confident decisions.</p>
    </div>`;

  const html = wrapEmail({
    previewText: `Your private Premarket insight report: ${title}`,
    bodyHTML: reportBody,
    recipientEmail: email,
    reason: 'You are receiving this report because your agent shared it with you via Premarket.',
  });

  await sendEmail({
    to: email,
    subject: `Premarket Report: ${title}`,
    html,
    attachments: [{ filename: 'Premarket-Report.pdf', content: pdfBuffer }],
  });

  return { success: true };
}

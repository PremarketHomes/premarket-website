import {
  BarChart3,
  Users,
  Home,
  Tv,
  Key,
  ShieldCheck,
  LinkIcon,
  Code,
  FileText,
  Clock,
  Contact2,
  Plug,
  Sparkles,
  BookOpen,
  Link2,
} from 'lucide-react';

export const TABS = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'users', label: 'Users', icon: Users },
  { key: 'properties', label: 'Properties', icon: Home },
  { key: 'displays', label: 'Displays', icon: Tv },
  { key: 'api', label: 'API Requests', icon: Key },
  { key: 'phi-verification', label: 'PHI Verification', icon: ShieldCheck },
  { key: 'docs-analytics', label: 'Docs Analytics', icon: LinkIcon },
  { key: 'dev-docs', label: 'Developer Docs', icon: Code },
  { key: 'recipient-links', label: 'Recipient Links (Phase 2 test)', icon: Link2 },
];

export const NAV_SECTIONS = [
  {
    label: 'Main',
    items: [
      { key: 'overview', label: 'Overview', icon: BarChart3, type: 'tab' },
      { key: 'users', label: 'Users', icon: Users, type: 'tab' },
      { key: 'properties', label: 'Properties', icon: Home, type: 'tab' },
      { key: 'displays', label: 'Displays', icon: Tv, type: 'tab' },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { key: 'phi-verification', label: 'PHI Verification', icon: ShieldCheck, type: 'tab' },
      { key: 'api', label: 'API Requests', icon: Key, type: 'tab' },
      { key: 'docs-analytics', label: 'Docs Analytics', icon: LinkIcon, type: 'tab' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { key: 'invoicing', label: 'Invoicing', icon: FileText, type: 'route', href: '/dashboard/admin/invoicing' },
      { key: 'crm', label: 'CRM', icon: Contact2, type: 'route', href: '/dashboard/crm' },
      { key: 'integrations', label: 'Integrations', icon: Plug, type: 'route', href: '/dashboard/integrations' },
      { key: 'cron', label: 'Cron Jobs', icon: Clock, type: 'tab' },
      { key: 'recipient-links', label: 'Recipient Links (Phase 2 test)', icon: Link2, type: 'tab' },
    ],
  },
  {
    label: 'Tools',
    items: [
      { key: 'playground', label: 'Playground', icon: Sparkles, type: 'route', href: '/dashboard/playground' },
      { key: 'developers', label: 'Developers', icon: Code, type: 'route', href: '/dashboard/developers' },
      { key: 'dev-docs', label: 'Dev Docs', icon: Code, type: 'tab' },
      { key: 'docs', label: 'API Docs', icon: BookOpen, type: 'route', href: '/docs' },
    ],
  },
];

export const USER_FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'agents', label: 'Agents' },
  { key: 'buyers', label: 'Buyers' },
  { key: 'pro', label: 'Pro' },
  { key: 'superadmin', label: 'Super Admin' },
];

export const PROPERTY_FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'public', label: 'Public' },
  { key: 'private', label: 'Private' },
  { key: 'archived', label: 'Archived' },
];

export const CRON_JOBS = [
  { key: 'compute-scores', label: 'Compute Scores', desc: 'Recompute all suburb market scores', schedule: 'Daily 2am', method: 'GET' },
  { key: 'compute-trends', label: 'Compute Trends', desc: 'Monthly suburb trend snapshots', schedule: '1st of month 3am', method: 'GET' },
  { key: 'cleanup-stale', label: 'Cleanup Stale', desc: 'Recompute stale cached scores', schedule: 'Every 6 hours', method: 'GET' },
  { key: 'sync-agentbox', label: 'Sync Agentbox', desc: 'Sync properties from Agentbox CRM', schedule: 'Every 2 hours', method: 'GET' },
  { key: 'compress-images', label: 'Compress Images', desc: 'Compress unoptimised property images', schedule: 'Every 15 min', method: 'GET' },
  { key: 'invoice-dry-run', label: 'Invoice Dry Run', desc: 'Auto-generate draft invoice run', schedule: 'Daily 4am', method: 'GET' },
  { key: 'property-followup', label: 'Property Follow-up', desc: 'Send 14/30 day follow-up emails', schedule: 'Daily 5am', method: 'GET' },
  { key: 'market-report', label: 'Market Report', desc: 'AI daily market health report card', schedule: 'Daily 6am' },
  { key: 'compute-contacts', label: 'Compute Contacts', desc: 'Build agent contact lists from CRM data', schedule: 'Daily 1am' },
  { key: 'newsletter', label: 'Buyer Newsletter', desc: 'Weekly buyer property newsletter', schedule: 'Saturday 9am AEST' },
];

export const API_STATUS_FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'revoked', label: 'Revoked' },
];

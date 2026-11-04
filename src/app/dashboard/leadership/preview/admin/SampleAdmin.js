'use client';

import { useState } from 'react';
import AdminLeadershipView from '../../../admin/leadership/AdminLeadershipView';

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const INITIAL = {
  offices: [
    { id: 'sample-1', name: 'Sample Agency', status: 'active',
      leaders: [
        { uid: 'l1', name: 'Sample Principal', email: 'principal@sample.test', leadershipOnly: true, roles: 'leadership' },
        { uid: 'l2', name: 'Sample Coach', email: 'coach@sample.test', leadershipOnly: false, roles: 'agent' },
      ],
      invites: [
        { inviteId: 'i1', email: 'newcoach@sample.test', name: 'New Coach', mode: 'new', status: 'pending', createdAt: daysAgo(1), expiresAt: daysAgo(-6) },
        { inviteId: 'i2', email: 'principal@sample.test', name: 'Sample Principal', mode: 'new', status: 'used', createdAt: daysAgo(20), expiresAt: daysAgo(13) },
        { inviteId: 'i3', email: 'old@sample.test', name: 'Old Invite', mode: 'new', status: 'expired', createdAt: daysAgo(30), expiresAt: daysAgo(23) },
      ] },
    { id: 'sample-2', name: 'Second Sample Office', status: 'active', leaders: [], invites: [] },
  ],
};

/** Local-only simulation: nothing is sent, saved or checked against any server. Try "existing@sample.test" for the approval step. */
export default function SampleAdmin() {
  const [data, setData] = useState(INITIAL);
  const edit = (officeId, fn) => setData((d) => ({ offices: d.offices.map((o) => (o.id === officeId ? fn(o) : o)) }));
  return (
    <AdminLeadershipView
      data={data}
      writesDisabledNote="Preview with sample data: inviting and revoking only change this page, and nothing is sent or saved. Try existing@sample.test to see the approval step for an existing account."
      onInvite={async ({ officeId, email, firstName, lastName, approveExisting }) => {
        const mail = email.trim().toLowerCase();
        const isExisting = mail === 'existing@sample.test';
        if (isExisting && !approveExisting) throw Object.assign(new Error('That email already has a Premarket account.'), { existing: { name: 'Existing Agent', email: mail, roles: 'agent', office: 'none' } });
        edit(officeId, (o) => ({ ...o, invites: [{ inviteId: `s${Date.now()}`, email: mail, name: `${firstName} ${lastName}`.trim(), mode: isExisting ? 'existing' : 'new', status: 'pending', createdAt: new Date().toISOString(), expiresAt: daysAgo(-7) }, ...o.invites] }));
        return { emailSent: true };
      }}
      onRevokeInvite={async ({ officeId, inviteId }) => edit(officeId, (o) => ({ ...o, invites: o.invites.map((i) => (i.inviteId === inviteId ? { ...i, status: 'revoked' } : i)) }))}
      onRevokeLeader={async ({ officeId, uid }) => edit(officeId, (o) => ({ ...o, leaders: o.leaders.filter((l) => l.uid !== uid) }))}
    />
  );
}

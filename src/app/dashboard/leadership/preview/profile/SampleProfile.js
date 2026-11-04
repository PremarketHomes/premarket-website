'use client';

import ProfileView from '../../ProfileView';

/** Client wrapper so the sample page can pass a (no-op) save handler. Nothing is saved. */
export default function SampleProfile({ welcome }) {
  return <ProfileView initial={{ firstName: 'Sam', lastName: 'Sample', avatar: null }} email="sam@sample.test" officeName="Sample Agency" welcome={welcome} sample hubHref="/dashboard/leadership/preview" onSave={async () => {}} />;
}

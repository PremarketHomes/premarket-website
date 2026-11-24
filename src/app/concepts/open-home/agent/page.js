import ConceptGate from '../_components/ConceptGate';
import AgentDashboard from '../_components/AgentDashboard';
import { requireAdminSignIn } from '../_lib/shareAccess';

export default async function OpenHomeAgentPage() {
  return (
    <ConceptGate requireAdmin={await requireAdminSignIn()}>
      <AgentDashboard />
    </ConceptGate>
  );
}

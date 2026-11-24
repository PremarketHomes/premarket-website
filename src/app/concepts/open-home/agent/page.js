import ConceptGate from '../_components/ConceptGate';
import AgentDashboard from '../_components/AgentDashboard';

export default function OpenHomeAgentPage() {
  return (
    <ConceptGate requireAdmin={process.env.VERCEL_ENV === 'production'}>
      <AgentDashboard />
    </ConceptGate>
  );
}

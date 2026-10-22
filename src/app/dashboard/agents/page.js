'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import { useRequireAgent } from '../../hooks/useRequireAgent';
import { db } from '../../firebase/clientApp';
import { collection, query, where, getDocs, doc, deleteDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { ArrowLeft, Plus, Pencil, Trash2, User, Users, Loader2 } from 'lucide-react';
import AgentModal from '../../components/AgentModal';

export default function AgentsPage() {
  useRequireAgent();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [agents, setAgents] = useState([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/join');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user) return;
    const fetchAgents = async () => {
      try {
        const snap = await getDocs(query(collection(db, 'agents'), where('userId', '==', user.uid)));
        setAgents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('Error fetching agents:', err);
      } finally {
        setPageLoading(false);
      }
    };
    fetchAgents();
  }, [user]);

  const handleSave = (savedAgent) => {
    setAgents((prev) => {
      const exists = prev.find((a) => a.id === savedAgent.id);
      if (exists) {
        return prev.map((a) => (a.id === savedAgent.id ? savedAgent : a));
      }
      return [...prev, savedAgent];
    });
  };

  const handleDelete = async (agentId) => {
    if (!confirm('Delete this agent? They will be unassigned from all properties.')) return;
    setDeletingId(agentId);
    try {
      // Remove agent doc
      await deleteDoc(doc(db, 'agents', agentId));

      // Clear agentId on associated properties
      const propsSnap = await getDocs(
        query(collection(db, 'properties'), where('agentId', '==', agentId))
      );
      if (propsSnap.docs.length > 0) {
        const batch = writeBatch(db);
        propsSnap.docs.forEach((d) => {
          batch.update(doc(db, 'properties', d.id), { agentId: null });
        });
        await batch.commit();
      }

      setAgents((prev) => prev.filter((a) => a.id !== agentId));
    } catch (err) {
      console.error('Error deleting agent:', err);
    } finally {
      setDeletingId(null);
    }
  };

  if (authLoading || pageLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-orange-500" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/dashboard')}
                className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-slate-600" />
              </button>
              <div>
                <h1 className="text-lg font-bold text-slate-900">Team</h1>
                <p className="text-xs text-slate-500">{agents.length} agent{agents.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
            <button
              onClick={() => { setEditingAgent(null); setShowModal(true); }}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-semibold text-sm rounded-xl shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 transition-all"
            >
              <Plus className="w-4 h-4" />
              Add Agent
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {agents.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl border border-slate-200 p-12 text-center"
          >
            <div className="w-20 h-20 bg-orange-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Users className="w-10 h-10 text-orange-500" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">No agents yet</h3>
            <p className="text-slate-500 mb-6 max-w-md mx-auto">
              Add agents to your team so you can assign them to specific properties.
            </p>
            <button
              onClick={() => { setEditingAgent(null); setShowModal(true); }}
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-semibold rounded-xl shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 transition-all"
            >
              <Plus className="w-5 h-5" />
              Add Your First Agent
            </button>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent) => (
              <motion.div
                key={agent.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-4">
                  {agent.avatar ? (
                    <img
                      src={agent.avatar}
                      alt={agent.name}
                      className="w-14 h-14 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                      <User className="w-7 h-7 text-orange-600" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{agent.name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-100">
                  <button
                    onClick={() => { setEditingAgent(agent); setShowModal(true); }}
                    className="flex-1 text-center px-3 py-2 text-xs font-semibold text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors flex items-center justify-center gap-1"
                  >
                    <Pencil className="w-3 h-3" />
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(agent.id)}
                    disabled={deletingId === agent.id}
                    className="px-3 py-2 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-50"
                  >
                    {deletingId === agent.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Trash2 className="w-3 h-3" />
                    )}
                    Delete
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Agent Modal */}
      <AnimatePresence>
        {showModal && (
          <AgentModal
            show={showModal}
            onClose={() => { setShowModal(false); setEditingAgent(null); }}
            onSave={handleSave}
            agent={editingAgent}
            userId={user.uid}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

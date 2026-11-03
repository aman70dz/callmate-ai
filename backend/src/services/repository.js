import { randomUUID } from 'node:crypto';
import { supabase } from '../config/supabase.js';
import { env } from '../config/env.js';

const demoTasks = new Map();
const demoAttempts = new Map();
const demoConversations = new Map();
const demoTranscripts = new Map();

export const repository = {
  async createTask(input) {
    if (env.DATA_MODE === 'supabase') {
      const { data, error } = await supabase.from('call_tasks').insert(input).select().single();
      if (error) throw error;
      return data;
    }
    const row = { id: randomUUID(), ...input, attempts_made: 0, status: 'pending', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    demoTasks.set(row.id, row);
    demoAttempts.set(row.id, []);
    return row;
  },
  async getTask(id) {
    if (env.DATA_MODE === 'supabase') {
      const { data, error } = await supabase.from('call_tasks').select('*').eq('id', id).single();
      if (error) throw error;
      return data;
    }
    return demoTasks.get(id) ?? null;
  },
  async listTasks(userId) {
    if (env.DATA_MODE === 'supabase') {
      const { data, error } = await supabase.from('call_tasks').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    }
    return [...demoTasks.values()].filter(x => x.user_id === userId).sort((a,b) => b.created_at.localeCompare(a.created_at));
  },
  async updateTask(id, patch) {
    if (env.DATA_MODE === 'supabase') {
      const { data, error } = await supabase.from('call_tasks').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single();
      if (error) throw error;
      return data;
    }
    const row = demoTasks.get(id);
    if (!row) return null;
    Object.assign(row, patch, { updated_at: new Date().toISOString() });
    return row;
  },
  async createAttempt(taskId, attemptNumber) {
    const input = { task_id: taskId, attempt_number: attemptNumber, status: 'queued' };
    if (env.DATA_MODE === 'supabase') {
      const { data, error } = await supabase.from('call_attempts').insert(input).select().single();
      if (error) throw error;
      return data;
    }
    const row = { id: randomUUID(), ...input, created_at: new Date().toISOString() };
    demoAttempts.get(taskId)?.push(row);
    return row;
  },
  async updateAttempt(id, patch) {
    if (env.DATA_MODE === 'supabase') {
      const { data, error } = await supabase.from('call_attempts').update(patch).eq('id', id).select().single();
      if (error) throw error;
      return data;
    }
    for (const attempts of demoAttempts.values()) {
      const row = attempts.find(a => a.id === id);
      if (row) return Object.assign(row, patch);
    }
    return null;
  },
  async getAttemptByProviderSid(sid) {
    if (env.DATA_MODE === 'supabase') {
      const { data, error } = await supabase.from('call_attempts').select('*').eq('provider_call_sid', sid).maybeSingle();
      if (error) throw error;
      return data;
    }
    for (const attempts of demoAttempts.values()) {
      const row = attempts.find(a => a.provider_call_sid === sid);
      if (row) return row;
    }
    return null;
  },
  async listAttempts(taskId) {
    if (env.DATA_MODE === 'supabase') {
      const { data, error } = await supabase.from('call_attempts').select('*').eq('task_id', taskId).order('attempt_number');
      if (error) throw error;
      return data;
    }
    return demoAttempts.get(taskId) ?? [];
  },
  async createConversation({ taskId, attemptId, language }) {
    const input = { task_id: taskId, attempt_id: attemptId || null, language: language || 'en' };
    if (env.DATA_MODE === 'supabase') {
      const { data, error } = await supabase.from('conversations').insert(input).select().single();
      if (error) throw error;
      return data;
    }
    const row = { id: randomUUID(), ...input, started_at: new Date().toISOString() };
    demoConversations.set(row.id, row);
    demoTranscripts.set(row.id, []);
    return row;
  },
  async getLatestConversation(taskId) {
    if (env.DATA_MODE === 'supabase') {
      const { data, error } = await supabase.from('conversations').select('*').eq('task_id', taskId).order('started_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    }
    const list = [...demoConversations.values()].filter(c => c.task_id === taskId).sort((a, b) => b.started_at.localeCompare(a.started_at));
    return list[0] ?? null;
  },
  async listTranscripts(conversationId) {
    if (env.DATA_MODE === 'supabase') {
      const { data, error } = await supabase.from('transcripts').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    }
    return demoTranscripts.get(conversationId) ?? [];
  },
  async saveTranscript(conversationId, speaker, message) {
    if (env.DATA_MODE === 'supabase') {
      const { error } = await supabase.from('transcripts').insert({ conversation_id: conversationId, speaker, message });
      if (error) throw error;
      return;
    }
    const list = demoTranscripts.get(conversationId) || [];
    list.push({ id: randomUUID(), conversation_id: conversationId, speaker, message, created_at: new Date().toISOString() });
    demoTranscripts.set(conversationId, list);
  }
};

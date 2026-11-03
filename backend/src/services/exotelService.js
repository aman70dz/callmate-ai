import axios from 'axios';
import FormData from 'form-data';
import { env, liveCallsEnabled } from '../config/env.js';

export async function placeExotelCall({ phoneNumber, taskId }) {
  if (!liveCallsEnabled) throw new Error('Live calling is disabled. Set ENABLE_LIVE_CALLS=true only after provider and compliance checks.');
  const required = ['EXOTEL_ACCOUNT_SID','EXOTEL_API_KEY','EXOTEL_API_TOKEN','EXOTEL_CALLER_ID','APP_BASE_URL'];
  const missing = required.filter(k => !env[k]);
  if (missing.length) throw new Error(`Missing Exotel configuration: ${missing.join(', ')}`);

  const base = env.APP_BASE_URL.replace(/\/$/, '');
  const form = new FormData();
  form.append('From', phoneNumber);
  form.append('CallerId', env.EXOTEL_CALLER_ID);
  form.append('StreamUrl', `${base.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')}/media?taskId=${encodeURIComponent(taskId)}&sample-rate=24000`);
  form.append('StreamType', 'bidirectional');
  form.append('TimeLimit', '300');
  form.append('CustomField', taskId);
  form.append('StatusCallback', `${base}/webhooks/exotel/status`);
  form.append('StatusCallbackEvents[]', 'answered');
  form.append('StatusCallbackEvents[]', 'terminal');

  const url = `${env.EXOTEL_BASE_URL}/v1/Accounts/${env.EXOTEL_ACCOUNT_SID}/Calls/connect`;
  const response = await axios.post(url, form, {
    auth: { username: env.EXOTEL_API_KEY, password: env.EXOTEL_API_TOKEN },
    headers: form.getHeaders(), timeout: 20000
  });
  const call = response.data?.Call;
  if (!call?.Sid) throw new Error('Exotel response did not include Call.Sid.');
  return { sid: call.Sid, status: call.Status };
}

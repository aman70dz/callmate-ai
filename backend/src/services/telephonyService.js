import { env } from '../config/env.js';
import { placeTwilioCall } from './twilioService.js';
import { placeExotelCall } from './exotelService.js';

export async function placeOutboundCall({ phoneNumber, taskId }) {
  const provider = env.TELEPHONY_PROVIDER || (env.TWILIO_ACCOUNT_SID ? 'twilio' : 'exotel');
  if (provider === 'twilio') {
    return await placeTwilioCall({ phoneNumber, taskId });
  }
  return await placeExotelCall({ phoneNumber, taskId });
}

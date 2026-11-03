import http from 'node:http';
import { env } from '../backend/src/config/env.js';

// We import the server file or start it
async function run() {
  console.log('--- Starting server in background for testing ---');
  
  // Dynamic import of the server
  const serverProcess = await import('../backend/src/server.js');
  
  // Wait 1.5s for port to bind
  await new Promise(r => setTimeout(r, 1500));

  const baseUrl = `http://127.0.0.1:${env.PORT}`;
  console.log(`Testing server at ${baseUrl}...`);

  // 1. TEST 1 & 2: GET /health
  console.log('\n--> Testing GET /health (TEST 1 & 2)...');
  try {
    const healthRes = await fetch(`${baseUrl}/health`);
    const healthData = await healthRes.json();
    console.log('Health response status:', healthRes.status);
    console.log('Health response body:', JSON.stringify(healthData));
    
    if (healthRes.ok && healthData.ok === true && healthData.service === 'callmate-ai' && healthData.liveCallsEnabled === false) {
      console.log('✓ TEST 1 & 2 PASSED: Server started and /health matches requirements.');
    } else {
      console.error('✗ TEST 2 FAILED: /health response invalid:', healthData);
    }
  } catch (err) {
    console.error('✗ TEST 1 & 2 FAILED:', err.message);
  }

  // 2. TEST 10: POST /api/assistant/prepare
  console.log('\n--> Testing POST /api/assistant/prepare (TEST 10)...');
  try {
    const prepareRes = await fetch(`${baseUrl}/api/assistant/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactName: 'Anil Kumar',
        instruction: 'Call Anil and inform him the project delivery date is confirmed for Friday.',
        language: 'en'
      })
    });
    const prepareData = await prepareRes.json();
    console.log('Prepare response status:', prepareRes.status);
    console.log('Prepare model used:', prepareData.model);
    console.log('Prepare plan:', JSON.stringify(prepareData.plan, null, 2));

    if (prepareRes.ok && prepareData.plan && prepareData.plan.objective && prepareData.plan.opening_message) {
      console.log('✓ TEST 10 PASSED: /api/assistant/prepare returned valid call plan.');
    } else {
      console.error('✗ TEST 10 FAILED: Invalid response from /api/assistant/prepare:', prepareData);
    }
  } catch (err) {
    console.error('✗ TEST 10 FAILED:', err.message);
  }

  // 3. TEST 11: POST /api/assistant/reply
  console.log('\n--> Testing POST /api/assistant/reply (TEST 11)...');
  try {
    const replyRes = await fetch(`${baseUrl}/api/assistant/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'en',
        recipientName: 'Anil Kumar',
        objective: 'Inform Anil that project delivery is Friday',
        keyPoints: ['Delivery Friday 4 PM', 'Client team attending'],
        transcript: [
          { speaker: 'assistant', text: 'Hello Anil, I am CallMate AI calling on behalf of the team.' }
        ],
        recipientMessage: 'Will the client also attend the Friday demo?'
      })
    });
    const replyData = await replyRes.json();
    console.log('Reply response status:', replyRes.status);
    console.log('Reply model used:', replyData.model);
    console.log('Reply text:', replyData.reply);

    if (replyRes.ok && replyData.reply) {
      console.log('✓ TEST 11 PASSED: /api/assistant/reply generated conversational response.');
    } else {
      console.error('✗ TEST 11 FAILED: Invalid response from /api/assistant/reply:', replyData);
    }
  } catch (err) {
    console.error('✗ TEST 11 FAILED:', err.message);
  }

  console.log('\n--- All server endpoint tests completed. Exiting test process. ---');
  process.exit(0);
}

run();


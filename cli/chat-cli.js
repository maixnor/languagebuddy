#!/usr/bin/env node
// filepath: /home/maixnor/repo/languagebuddy/cli/chat-cli.js

const readline = require('readline');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const crypto = require('crypto');
const http = require('http');

// Configuration
const config = {
  serverUrl: 'http://localhost:8080', // Default local server URL (matches PORT in .env)
  userPhone: '436802456552', // Default test phone number
  apiVersion: 'v18.0', // Match WhatsApp API version
  responsePort: 3333, // Port for the local server to receive responses
};

// Set environment variable for the server to know where to send responses
process.env.USE_LOCAL_CLI_ENDPOINT = `http://localhost:${config.responsePort}/cli-response`;

// CLI state
const state = {
  conversationActive: false,
  waitingForResponse: false,
};

// Create readline interface for CLI
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Function to generate a random message ID similar to WhatsApp
function generateMessageId() {
  return crypto.randomUUID();
}

// Function to send a message through the webhook endpoint
async function sendMessage(text) {
  try {
    state.waitingForResponse = true;

    // Format the request body to match WhatsApp Cloud API structure
    const webhookBody = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'test-waba-id',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: config.userPhone,
                  phone_number_id: 'test-phone-id',
                },
                contacts: [
                  {
                    profile: {
                      name: 'Test User',
                    },
                    wa_id: config.userPhone,
                  },
                ],
                messages: [
                  {
                    id: generateMessageId(),
                    from: config.userPhone,
                    timestamp: Math.floor(Date.now() / 1000),
                    type: 'text',
                    text: {
                      body: text,
                    },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    // Send the webhook request
    const response = await fetch(`${config.serverUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(webhookBody),
    });

    if (!response.ok) {
      throw new Error(`Server responded with status ${response.status}`);
    }

    return true;
  } catch (error) {
    console.error(`Error sending message: ${error.message}`);
    state.waitingForResponse = false;
    return false;
  }
}

// Function to check server health
async function checkHealth() {
  try {
    const response = await fetch(`${config.serverUrl}/health`);
    if (response.ok) {
      const data = await response.json();
      console.log('Server health status:', JSON.stringify(data, null, 2));
      return true;
    }
    console.error(`Server health check failed with status: ${response.status}`);
    return false;
  } catch (error) {
    console.error(`Health check error: ${error.message}`);
    return false;
  }
}

async function sendDailyInit() {
  try {
    const repsose = await fetch(`${config.serverUrl}/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({phone: config.userPhone}),
    });
    console.log(`initiated new conversation for ${config.userPhone}`)
  } catch (error) {
    console.error('initiating failed');
    return false;
  }
}

// Set up local HTTP server to receive responses
function setupResponseServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/cli-response' && req.method === 'POST') {
      let body = '';

      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', () => {
        try {
          const responseData = JSON.parse(body);

          // Pretty print the received message
          console.log('\n📱 Received response:');
          console.log(`${responseData.text.split('\n').map(line => `>>> ${line}`).join('\n')}`);
          console.log('\nmessage: '); // Prompt for next message

          state.waitingForResponse = false;

          // Send successful response back to the server
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'received' }));
        } catch (e) {
          console.error('Error processing response:', e);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: e.message }));
        }
      });
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'not found' }));
    }
  });

  server.listen(config.responsePort, () => {
    console.log(`Response server listening on port ${config.responsePort}`);
  });

  server.on('error', (err) => {
    console.error(`Response server error: ${err.message}`);
    process.exit(1);
  });

  return server;
}

// Initialize CLI
function initCLI() {
  console.log('📱 WhatsApp CLI Simulator');
  console.log('=========================');
  console.log(`Connected to server: ${config.serverUrl}`);
  console.log(`Using phone number: ${config.userPhone}`);
  console.log(`Listening for responses at: http://localhost:${config.responsePort}/cli-response`);
  console.log('\nCommands:');
  console.log('  /health - Check server health');
  console.log('  /exit - Exit the CLI');
  console.log('  /clear - Send !clear command to reset conversation');
  console.log('  /daily - Initiate a daily conversation')
  console.log('  /phone <number> - Change your simulated phone number');
  console.log('  /server <url> - Change server URL');
  console.log('\nType a message and press Enter to send it.\n');

  // Process input
  rl.on('line', async (line) => {
    line = line.trim();

    // Handle commands
    if (line.startsWith('/')) {
      const [command, ...args] = line.slice(1).split(' ');

      switch (command) {
        case 'exit':
          console.log('Exiting CLI. Goodbye!');
          rl.close();
          process.exit(0);
          break;

        case 'health':
          console.log('Checking server health...');
          await checkHealth();
          break;

        case 'clear':
          console.log('Sending clear command...');
          await sendMessage('!clear');
          console.log('Conversation history cleared.');
          break;

        case 'daily':
          console.log('initiating a new conversation');
          await sendDailyInit();
          break;

        case 'phone':
          if (args[0]) {
            config.userPhone = args[0];
            console.log(`Phone number changed to: ${config.userPhone}`);
          } else {
            console.log(`Current phone number: ${config.userPhone}`);
          }
          break;

        case 'server':
          if (args[0]) {
            config.serverUrl = args[0];
            console.log(`Server URL changed to: ${config.serverUrl}`);
          } else {
            console.log(`Current server URL: ${config.serverUrl}`);
          }
          break;

        default:
          console.log(`Unknown command: ${command}`);
          break;
      }

      return;
    }

    // Send regular message
    const sent = await sendMessage(line);
    if (sent) {
      console.log('Message sent. Waiting for response...');
    }
  });
}

// Start the CLI
async function start() {
  try {
    // Start response server
    const responseServer = setupResponseServer();

    // Check if server is healthy before starting
    const isHealthy = await checkHealth();
    if (!isHealthy) {
      console.log('Warning: Server might not be running or is unhealthy.');
      console.log('You can still try to use the CLI, but it might not work properly.');
    }

    // Start the CLI
    initCLI();
  } catch (error) {
    console.error('Error starting CLI:', error.message);
    process.exit(1);
  }
}

// Run the CLI
start();

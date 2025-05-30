import Redis from 'ioredis';
import dotenv from 'dotenv';
import pino from 'pino';

// Initialize logger
const logger = pino();

// Load environment variables from .env file
dotenv.config();

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
const redisPassword = process.env.REDIS_PASSWORD;

logger.info(redisHost);
logger.info(redisPort);
logger.info(redisPassword);

async function testRedisConnection() {
  logger.info(`Attempting to connect to Redis at ${redisHost}:${redisPort}...`);

  const client = new Redis({
    host: redisHost,
    port: redisPort,
    password: redisPassword,
    // For Azure Cache for Redis, SSL might be required
    // tls: redisPort === 6380 ? {} : undefined, 
    // lazyConnect: true, // Connects on first command, useful for apps, but for a test we want to connect immediately
  });

  client.on('connect', () => {
    logger.info('Successfully connected to Redis for test!');
  });

  client.on('error', (err) => {
    logger.error({ err }, 'Redis test connection error:');
  });

  try {
    // Wait for connection if not using lazyConnect or if initial connection is pending
    // For a direct test, an explicit connect call or waiting for the 'connect' event is good practice.
    // However, ioredis often queues commands until connected.

    logger.info('Pinging server...');
    const pong = await client.ping();
    logger.info(`Ping response: ${pong}`);

    if (pong !== 'PONG') {
      logger.error('Redis server did NOT respond to PING as expected.');
      await client.quit();
      return;
    }
    logger.info('Redis server responded to PING successfully.');

    const testKey = 'my_typescript_test_key';
    const testValue = 'hello_redis_from_typescript_test_' + Date.now();

    logger.info(`Setting key '${testKey}' to '${testValue}'`);
    await client.set(testKey, testValue);
    logger.info('Key set.');

    logger.info(`Getting key '${testKey}'`);
    const retrievedValue = await client.get(testKey);
    logger.info(`Retrieved value: ${retrievedValue}`);

    if (retrievedValue === testValue) {
      logger.info('SUCCESS: Retrieved value matches set value.');
    } else {
      logger.error(`ERROR: Retrieved value '${retrievedValue}' does not match expected '${testValue}'.`);
    }

    logger.info(`Deleting key '${testKey}'`);
    await client.del(testKey);
    logger.info('Test key deleted.');

  } catch (error) {
    logger.error({ err: error }, 'An error occurred during the Redis test:');
  } finally {
    logger.info('Disconnecting Redis test client...');
    await client.quit();
    logger.info('Redis test client disconnected.');
  }
}

// Run the test
testRedisConnection().catch(err => {
  logger.error({ err }, 'Failed to run Redis test script:');
});

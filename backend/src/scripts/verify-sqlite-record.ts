import { DatabaseService } from '../core/database';
import path from 'path';
import { pino } from 'pino';

const logger = pino({ name: 'verify-sqlite-record' });

const SQLITE_DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'languagebuddy.sqlite');

async function verifySqliteRecord(phoneNumber: string) {
  logger.info(`Verifying record for phone number: ${phoneNumber} in SQLite.`);

  const dbService = new DatabaseService(SQLITE_DB_PATH);
  const sqlite = dbService.getDb();
  dbService.migrate(); // Ensure tables are created

  try {
    const subscriberStmt = sqlite.prepare('SELECT * FROM subscribers WHERE phone_number = ?');
    const subscriberRecord = subscriberStmt.get(phoneNumber);

    if (subscriberRecord) {
      logger.info(`Found subscriber record for ${phoneNumber}:`);
      logger.info(JSON.stringify(subscriberRecord, null, 2));
    } else {
      logger.warn(`Subscriber record for ${phoneNumber} not found.`);
    }

    const checkpointStmt = sqlite.prepare('SELECT * FROM checkpoints WHERE thread_id = ?');
    const checkpointRecord = checkpointStmt.get(phoneNumber);

    if (checkpointRecord) {
      logger.info(`Found checkpoint record for ${phoneNumber}:`);
      logger.info(JSON.stringify(checkpointRecord, null, 2));
    } else {
      logger.warn(`Checkpoint record for ${phoneNumber} not found.`);
    }

  } catch (error) {
    logger.error({ err: error }, 'Error while verifying SQLite record.');
  } finally {
    dbService.close();
    logger.info('SQLite connection closed.');
  }
}

const targetPhoneNumber = '+436802456552';
verifySqliteRecord(targetPhoneNumber).catch(console.error);

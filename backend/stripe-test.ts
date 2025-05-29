import dotenv from "dotenv";
import pino from 'pino';

import { readFileSync } from 'fs';
import path from 'path';
const yaml = require('js-yaml');

import { initStripe, checkStripeSubscription } from './stripe';
import OpenAI from "openai";

dotenv.config();

const logger = pino({});
const whatsappPhone = '436802456552'

initStripe('sk_test_51RTTD31ofydU9hAs17W6dM54KTuShwM6Z8bKfqSXOWEuGL2ER47NPfZuNDUNKBLOAMeTitlJxuS3vrXuG9p3nWuf006fu2QODQ', logger)

const hasPaid = checkStripeSubscription(whatsappPhone);

logger.info({hasPaid});


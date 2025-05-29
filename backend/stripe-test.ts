import dotenv from "dotenv";
import { initStripe, checkStripeSubscription } from './stripe';
import { logger } from "./types";

logger.level = "warn";
dotenv.config();

const whatsappPhone = '436802456552'

initStripe('sk_test_51RTTD31ofydU9hAs17W6dM54KTuShwM6Z8bKfqSXOWEuGL2ER47NPfZuNDUNKBLOAMeTitlJxuS3vrXuG9p3nWuf006fu2QODQ', logger)

const hasPaid = checkStripeSubscription(whatsappPhone);

logger.info({hasPaid});

logger.warn("All stripe tests passed!");


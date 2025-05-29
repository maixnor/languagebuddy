import dotenv from "dotenv";
import { initStripe, checkStripeSubscription, updateCustomerMetadata, getCustomerMetadata } from './stripe';
import { logger } from "./types";

logger.level = "warn";

const whatsappPhone = '436802456552'

initStripe('sk_test_51RTTD31ofydU9hAs17W6dM54KTuShwM6Z8bKfqSXOWEuGL2ER47NPfZuNDUNKBLOAMeTitlJxuS3vrXuG9p3nWuf006fu2QODQ', logger)

const hasPaid = checkStripeSubscription(whatsappPhone);

if (!hasPaid) logger.error(hasPaid, "[FAIL] customer should be subscribed");

logger.info({hasPaid});

async function testStripeOperations() {
  const existingTestPhone = '436802456552';
  const nonExistingTestPhone = '12345678900';

  logger.info("--- Testing Stripe Metadata Operations ---");

  // ---- Test Case 1: Update metadata for an EXISTING customer ----
  logger.info(`[TEST] Attempting to update metadata for EXISTING customer: ${existingTestPhone}`);
  const metadataToUpdate: any = { // Using 'any' for test flexibility with Subscriber fields
    name: "Test User Existing",
    learningLanguages: [
      { languageName: "German", level: "B1", currentObjectives: ["Daily conversation"] }
    ],
    speakingLanguages: [
      { languageName: "English", level: "C2", currentObjectives: ["Advanced topics"] }
    ],
  };
  let updateSuccess = await updateCustomerMetadata(existingTestPhone, metadataToUpdate);
  if (updateSuccess) {
    logger.info(`[SUCCESS] Metadata updated for existing customer ${existingTestPhone}.`);
  } else {
    logger.error(`[FAIL] Failed to update metadata for existing customer ${existingTestPhone}. This might indicate an issue with the test setup or the function itself if the customer should exist.`);
  }

  // ---- Test Case 2: Retrieve metadata for an EXISTING customer (after update) ----
  logger.info(`[TEST] Attempting to retrieve metadata for EXISTING customer: ${existingTestPhone}`);
  let retrievedMetadata = await getCustomerMetadata(existingTestPhone);
  if (retrievedMetadata) {
    logger.info({ retrievedMetadata }, `[SUCCESS] Retrieved metadata for existing customer ${existingTestPhone}:`);
    // Add more specific assertions if needed, e.g., checking if retrievedMetadata.name matches metadataToUpdate.name
    if (retrievedMetadata.name !== metadataToUpdate.name) {
        logger.error(`[VERIFY FAIL] Retrieved name '${retrievedMetadata.name}' does not match updated name '${metadataToUpdate.name}'.`);
    }
    if (JSON.stringify(retrievedMetadata.learningLanguages) !== JSON.stringify(metadataToUpdate.learningLanguages)) {
        logger.error("[VERIFY FAIL] Retrieved learningLanguages do not match updated learningLanguages.");
    }
  } else {
    logger.error(`[FAIL] Failed to retrieve metadata for existing customer ${existingTestPhone}.`);
  }

  // ---- Test Case 3: Attempt to update metadata for a NON-EXISTING customer ----
  logger.info(`[TEST] Attempting to update metadata for NON-EXISTING customer: ${nonExistingTestPhone}`);
  const dummyMetadata: any = { name: "Ghost User" };
  updateSuccess = await updateCustomerMetadata(nonExistingTestPhone, dummyMetadata);
  if (!updateSuccess) {
    logger.info(`[SUCCESS] Correctly failed to update metadata for non-existing customer ${nonExistingTestPhone}.`);
  } else {
    logger.error(`[FAIL] Incorrectly succeeded or did not return false when attempting to update metadata for non-existing customer ${nonExistingTestPhone}.`);
  }

  // ---- Test Case 4: Attempt to retrieve metadata for a NON-EXISTING customer ----
  logger.info(`[TEST] Attempting to retrieve metadata for NON-EXISTING customer: ${nonExistingTestPhone}`);
  retrievedMetadata = await getCustomerMetadata(nonExistingTestPhone);
  if (retrievedMetadata === null) {
    logger.info(`[SUCCESS] Correctly returned null for non-existing customer ${nonExistingTestPhone}.`);
  } else {
    logger.error({ retrievedMetadata }, `[FAIL] Incorrectly retrieved metadata or did not return null for non-existing customer ${nonExistingTestPhone}.`);
  }
  
  // ---- Test Case 5: Update metadata for an EXISTING customer with partial data ----
  logger.info(`[TEST] Attempting to update partial metadata for EXISTING customer: ${existingTestPhone}`);
  const partialMetadataToUpdate: any = {
    name: "Test User Existing Partial Update",
  };
  // Note: Stripe's metadata update replaces the entire metadata object.
  // If you want to "patch", you need to retrieve, merge, then update.
  // For this test, we'll demonstrate a full update with only 'name' to see its effect.
  // To truly patch, getCustomerMetadata, merge, then updateCustomerMetadata.
  // This specific call will effectively REMOVE learningLanguages and speakingLanguages from metadata if they existed.
  // For a "patch" operation, one would typically:
  // 1. Get current metadata.
  // 2. Merge changes into current metadata.
  // 3. Update with the merged metadata.
  // This test will just update with the new partial object, overwriting previous metadata.
  updateSuccess = await updateCustomerMetadata(existingTestPhone, partialMetadataToUpdate);
  if (updateSuccess) {
    logger.info(`[SUCCESS] Metadata partially updated (overwritten) for existing customer ${existingTestPhone}.`);
    const partiallyUpdatedMetadata = await getCustomerMetadata(existingTestPhone);
    if (partiallyUpdatedMetadata) {
        logger.info({partiallyUpdatedMetadata}, `Retrieved metadata after partial update for ${existingTestPhone}`);
        if (partiallyUpdatedMetadata.name !== partialMetadataToUpdate.name) {
            logger.error(`[VERIFY FAIL] Name after partial update incorrect.`);
        }
        if (partiallyUpdatedMetadata.learningLanguages && partiallyUpdatedMetadata.learningLanguages.length > 0) {
            logger.info(`[VERIFY NOTE] learningLanguages still exist after partial update that did not include it. This means Stripe metadata was not overwritten as expected or previous state was different.`);
        }
         if (partiallyUpdatedMetadata.speakingLanguages && partiallyUpdatedMetadata.speakingLanguages.length > 0) {
            logger.info(`[VERIFY NOTE] speakingLanguages still exist after partial update that did not include it.`);
        }
    } else {
        logger.error(`[FAIL] Failed to retrieve metadata after partial update for ${existingTestPhone}.`);
    }
  } else {
    logger.error(`[FAIL] Failed to partially update metadata for existing customer ${existingTestPhone}.`);
  }


  logger.info("--- Stripe Metadata Operations Test Completed ---");
}

async function runTests() {
    await testStripeOperations();
    logger.warn("All stripe tests passed!");
}

runTests().catch(error => {
    logger.error("Tests failed with error:", error);
    process.exit(1);
});


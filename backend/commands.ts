import { Subscriber, logger } from "./types";

export function handleGptCommands(responseTextToUser: string, subscriber: Subscriber) {
  if (!responseTextToUser) return { responseTextToUser, rawCommandFromGpt: "", gptCommandProcessedSuccessfully: true };
  const lines = responseTextToUser!.split('\n');
  let rawCommandFromGpt = "";
  let gptCommandProcessedSuccessfully = false;
  while (true) { // parse and remove GPT commands from response
    logger.info(lines[0])
    const commandMatch = lines[0].match(/^!SUBSCRIBERDATA.*/);
    if (!SUBSCRIBERDATAMatch) break;

    rawCommandFromGpt = lines[0];
    logger.info(rawCommandFromGpt);
    const jsonPayloadString = rawCommandFromGpt.substring(9); // Extract JSON payload from command
    try {
      const commandData = JSON.parse(jsonPayloadString);
      logger.info({ userPhone: subscriber.phone, commandData }, "Parsed GPT command data for merging");

      Object.assign(subscriber, commandData);
      
      logger.info({ userPhone: subscriber.phone, updatedFields: commandData, resultingSubscriber: subscriber }, "Subscriber updated via GPT command merge");
      gptCommandProcessedSuccessfully = true;

    } catch (e) {
      logger.error({ err: e, userPhone: subscriber.phone, commandLine: lines[0], jsonString: jsonPayloadString }, "Error parsing GPT command JSON or merging. Command will be stripped.");
      gptCommandProcessedSuccessfully = false;
    }

    if (gptCommandProcessedSuccessfully) {
      lines.shift();
      responseTextToUser = lines.join('\\n').trim();
    } else {
      logger.warn({ userPhone: subscriber.phone, command: lines[0] }, "GPT command processing failed. Stripping command from response.");
      lines.shift();
      responseTextToUser = lines.join('\\n').trim();
    }
  }
  return { responseTextToUser, rawCommandFromGpt, gptCommandProcessedSuccessfully, subscriber };
}

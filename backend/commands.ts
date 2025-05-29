import { Subscriber, logger } from "./main";

export function handleGptCommands(responseTextToUser: string | null | undefined, subscriber: Subscriber) {
  if (!responseTextToUser) return { responseTextToUser, rawCommandFromGpt: "", gptCommandProcessedSuccessfully: true };
  const lines = responseTextToUser!.split('\n');
  let rawCommandFromGpt = "";
  let gptCommandProcessedSuccessfully = false;
  while (true) { // parse and remove GPT commands from response
    const commandMatch = lines[0].match(/^!COMMAND\s+(\w+)=(.+)/);
    if (!commandMatch) break;

    rawCommandFromGpt = lines[0];
    const attributeName = commandMatch[1];
    const attributeValueString = commandMatch[2].trim();
    try {
      const attributeValue = JSON.parse(attributeValueString);
      logger.info({ userPhone: subscriber.phone, attributeName, attributeValue }, "Attempting to process GPT command");

      if (attributeName === "speakingLanguages" && Array.isArray(attributeValue)) {
        subscriber.speakingLanguages = attributeValue
          .filter(lang => typeof lang === 'string')
          .map(langName => ({ languageName: langName, level: "", currentObjectives: [] }));
        logger.info({ userPhone: subscriber.phone, speakingLanguages: subscriber.speakingLanguages }, "Updated subscriber speakingLanguages via GPT command");
        gptCommandProcessedSuccessfully = true;
      } else if (attributeName === "learningLanguages" && Array.isArray(attributeValue)) {
        subscriber.learningLanguages = attributeValue.filter(lang => lang && typeof lang.languageName === 'string' &&
          (typeof lang.level === 'string' || lang.level === undefined || lang.level === null) &&
          (Array.isArray(lang.currentObjectives) || lang.currentObjectives === undefined || lang.currentObjectives === null)
        ).map(lang => ({
          languageName: lang.languageName,
          level: lang.level || "",
          currentObjectives: lang.currentObjectives || []
        }));
        logger.info({ userPhone: subscriber.phone, learningLanguages: subscriber.learningLanguages }, "Updated subscriber learningLanguages via GPT command");
        gptCommandProcessedSuccessfully = true;
      } else if (attributeName === "name") {
        subscriber.name = attributeValue;
        gptCommandProcessedSuccessfully = true;
      }
      // Add more command handlers here for other attributes
      if (gptCommandProcessedSuccessfully) {
        lines.shift(); // Remove the command line
        responseTextToUser = lines.join('\n').trim();
      } else {
        logger.warn({ userPhone: subscriber.phone, command: lines[0] }, "GPT command not recognized or failed validation. Stripping command from response.");
        lines.shift(); // Strip unrecognized/invalid command
        responseTextToUser = lines.join('\n').trim();
      }
    } catch (e) {
      logger.error({ err: e, userPhone: subscriber.phone, commandLine: lines[0] }, "Error parsing GPT command JSON value. Command stripped.");
      lines.shift(); // Remove the malformed command line
      responseTextToUser = lines.join('\n').trim();
    }
  }
  return { responseTextToUser, rawCommandFromGpt, gptCommandProcessedSuccessfully, subscriber };
}

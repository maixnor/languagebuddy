import OpenAI from "openai";
import { getGPTResponse } from "./gpt";
import { Subscriber, logger } from "./types";
import { sendWhatsAppMessage } from "./whatsapp";

export async function handleUserCommand(messageText: string, subscriber: Subscriber): Promise<boolean> {
  const commandParts = messageText.trim().split(" ");
  const mainCommand = commandParts[0].toLowerCase();

  if (mainCommand === "!help") {
    const helpText = "Available commands:\n" +
                     "!help - Show this help message\n" +
                     "!define <word> - Get definition of a word\n" +
                     "!myinfo - Show your current language profile";
    await sendWhatsAppMessage(subscriber.phone, helpText);
    return true;
  } else if (mainCommand === "!define" && commandParts.length > 1) {
    const termToDefine = commandParts.slice(1).join(" ");
    try {
      const definitionPrompt = `Define the term "${termToDefine}" concisely for a language learner.`;
      const tempMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: "You are a helpful dictionary." },
        { role: "user", content: definitionPrompt }
      ];
      const definitionResponse = await getGPTResponse(tempMessages);
      if (definitionResponse?.content) {
        await sendWhatsAppMessage(subscriber.phone, `Definition of "${termToDefine}":\n${definitionResponse.content}`);
      } else {
        await sendWhatsAppMessage(subscriber.phone, `Sorry, I couldn\'t define "${termToDefine}" at the moment.`);
      }
    } catch (error) {
      logger.error({ err: error, term: termToDefine }, `Error defining term "${termToDefine}":`);
      await sendWhatsAppMessage(subscriber.phone, "Sorry, there was an error getting the definition.");
    }
    return true;
  } else if (mainCommand === "!myinfo") {
    let infoText = `Your Language Profile:\n`;
    infoText += `Speaking Languages: ${subscriber.speakingLanguages.length > 0 ? subscriber.speakingLanguages.map(lang => lang.languageName).join(', ') : 'None set'}\n`; // Corrected this line
    infoText += "Learning Languages:\n";
    if (subscriber.learningLanguages.length > 0) {
      subscriber.learningLanguages.forEach(lang => {
        infoText += `  - ${lang.languageName}: Level ${lang.level} (Objectives: ${lang.currentObjectives.join(', ') || 'None'})\n`;
      });
    } else {
      infoText += "  None set\n";
    }
    await sendWhatsAppMessage(subscriber.phone, infoText);
    return true;
  }

  return false; // Not a recognized command
}

export function handleGptCommands(responseTextToUser: string, subscriber: Subscriber) {
  if (!responseTextToUser) return { responseTextToUser, rawCommandFromGpt: "", gptCommandProcessedSuccessfully: true };
  const lines = responseTextToUser!.split('\n');
  let rawCommandFromGpt = "";
  let gptCommandProcessedSuccessfully = false;
  while (true) { // parse and remove GPT commands from response
    logger.info(lines[0])
    const commandMatch = lines[0].match(/^!SUBSCRIBERDATA.*/);
    if (!commandMatch) break;

    rawCommandFromGpt = lines[0];
    logger.info(rawCommandFromGpt);
    const jsonPayloadString = rawCommandFromGpt.substring(16); // Extract JSON payload from command
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

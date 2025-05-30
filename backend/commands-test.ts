import { exit } from "node:process";
import { handleGptCommands } from "./commands";
import { logger, Subscriber } from "./types";

logger.level = "warn";

const subscriber: Subscriber = {
    phone: "436801231233",
    name: "",
    speakingLanguages: [{ languageName: "English", currentObjectives: [], level: "native" }],
    learningLanguages: [{ languageName: "Spanish", currentObjectives: ["at the cafe", "at the market"], level: "beginner" }],
    messageHistory: []
}

const message = '!SUBSCRIBERDATA {"name":"Herbert"}\n this is the message'

const ok = handleGptCommands(message, subscriber)
logger.info(ok);

if (subscriber.name !== "Herbert") exit(1);

// Test case 2: Update name, speakingLanguages, and learningLanguages
const subscriber2: Subscriber = {
    phone: "436801231234",
    name: "Old Name",
    speakingLanguages: [ { languageName: "English", currentObjectives: [], level: "mothertongue" }],
    learningLanguages: [{ languageName: "Spanish", currentObjectives: ["at the cafe", "at the market"], level: "beginner" }],
    messageHistory: []
};

const message2 = '!SUBSCRIBERDATA {"name":"New Name","speakingLanguages":[{"languageName":"German", "currentObjectives":[], "level":"conversational"},{"languageName":"French", "currentObjectives":[], "level":"fluent"}],"learningLanguages":[{"languageName":"Italian", "currentObjectives":[], "level":"beginner"},{"languageName":"Portuguese", "currentObjectives":[], "level":"intermediate"}]}\nAnother message content';
const result2 = handleGptCommands(message2, subscriber2);
logger.info({result: result2, subscriber: subscriber2}, "Test Case 2 Results");

if (subscriber2.name !== "New Name") {
    logger.error("Test Case 2 Failed: Name not updated correctly");
    exit(1);
}
if (JSON.stringify(subscriber2.speakingLanguages) !== JSON.stringify([{"languageName":"German", "currentObjectives":[], "level":"conversational"},{"languageName":"French", "currentObjectives":[], "level":"fluent"}])) {
    logger.error("Test Case 2 Failed: speakingLanguages not updated correctly");
    exit(1);
}
if (JSON.stringify(subscriber2.learningLanguages) !== JSON.stringify([{"languageName":"Italian", "currentObjectives":[], "level":"beginner"},{"languageName":"Portuguese", "currentObjectives":[], "level":"intermediate"}])) {
    logger.error("Test Case 2 Failed: learningLanguages not updated correctly");
    exit(1);
}
if (result2.responseTextToUser !== "Another message content") {
    logger.error("Test Case 2 Failed: responseTextToUser not stripped correctly");
    exit(1);
}

// Test case 3: Multiple commands, only the last one for a field should apply if not merged, but we merge.
// Let's test merging behavior with a more complex scenario.
// Since Object.assign is used, later properties in the same command object will overwrite earlier ones.
// And if multiple !SUBSCRIBERDATA lines exist, they are processed sequentially, each modifying the subscriber.
const subscriber3: Subscriber = {
    phone: "436801231235",
    name: "Initial Name",
    speakingLanguages: [{ languageName: "English", currentObjectives: [], level: "native" }],
    learningLanguages: [],
    messageHistory: []
};

// First command updates name and adds a speaking language.
// Second command updates name again and adds a learning language.
const message3 = '!SUBSCRIBERDATA {"name":"Intermediate Name","speakingLanguages":[{"languageName":"English", "currentObjectives":[], "level":"native"},{"languageName":"Spanish", "currentObjectives":["ordering food"], "level":"fluent"}]}\n!SUBSCRIBERDATA {"name":"Final Name","learningLanguages":[{"languageName":"German", "currentObjectives":["basic greetings"], "level":"beginner"}]}\nFinal message';
const result3 = handleGptCommands(message3, subscriber3);
logger.info({result: result3, subscriber: subscriber3}, "Test Case 3 Results");

if (subscriber3.name !== "Final Name") {
    logger.error(`Test Case 3 Failed: Name not updated correctly. Expected "Final Name", got "${subscriber3.name}"`);
    exit(1);
}
// Object.assign replaces arrays, not merges them.
// First command: subscriber.speakingLanguages = [{"languageName":"English", "currentObjectives":[], "level":"native"},{"languageName":"Spanish", "currentObjectives":["ordering food"], "level":"fluent"}]
// Second command doesn't touch speakingLanguages, so it remains as is.
if (JSON.stringify(subscriber3.speakingLanguages) !== JSON.stringify([{"languageName":"English", "currentObjectives":[], "level":"native"},{"languageName":"Spanish", "currentObjectives":["ordering food"], "level":"fluent"}])) {
    logger.error(`Test Case 3 Failed: speakingLanguages not updated correctly. Expected ${JSON.stringify([{"languageName":"English", "currentObjectives":[], "level":"native"},{"languageName":"Spanish", "currentObjectives":["ordering food"], "level":"fluent"}])}, got ${JSON.stringify(subscriber3.speakingLanguages)}`);
    exit(1);
}
if (JSON.stringify(subscriber3.learningLanguages) !== JSON.stringify([{"languageName":"German", "currentObjectives":["basic greetings"], "level":"beginner"}])) {
    logger.error(`Test Case 3 Failed: learningLanguages not updated correctly. Expected ${JSON.stringify([{"languageName":"German", "currentObjectives":["basic greetings"], "level":"beginner"}])}, got ${JSON.stringify(subscriber3.learningLanguages)}`);
    exit(1);
}
if (result3.responseTextToUser !== "Final message") {
    logger.error(`Test Case 3 Failed: responseTextToUser not stripped correctly. Expected "Final message", got "${result3.responseTextToUser}"`);
    exit(1);
}

logger.warn("All GPT Commands tests passed!");

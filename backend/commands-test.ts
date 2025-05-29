import { exit } from "node:process";
import { handleGptCommands } from "./commands";
import { logger, Subscriber } from "./types";

const subscriber: Subscriber = {
    phone: "436801231233", 
    name: "",
    speakingLanguages: [],
    learningLanguages: [],
    messageHistory: []
}

const message = '!COMMAND {"name":"Herbert"}\n this is the message'

const ok = handleGptCommands(message, subscriber)
logger.info(ok);

if (subscriber.name !== "Herbert") exit(1);

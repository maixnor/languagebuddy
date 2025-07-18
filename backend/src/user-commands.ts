import { Subscriber } from './types';
import { whatsappService } from './main';
import { languageBuddyAgent } from './main';
import { logger } from './config';

export async function handleUserCommand(subscriber: Subscriber, message: string) {
    if (message === 'ping') {
        logger.info("Received ping message, responding with pong.");
        await whatsappService.sendMessage(subscriber.connections.phone, "pong");
        return "ping";
    }

    if (message.startsWith('!clear')) {
        logger.info("Received !clear command, clearing conversation history.");
        await languageBuddyAgent.clearConversation(subscriber.connections.phone);
        await whatsappService.sendMessage(subscriber.connections.phone, "Conversation history cleared.");
        return '!clear';
    }

    if (message.startsWith('!me')) {
        const info = `Your profile:\nName: ${subscriber.profile.name}\nSpeaking: ${(subscriber.profile.speakingLanguages?.map(l => l.languageName + (l.level ? ` (${l.level})` : '')).join(', ') || 'Not set')}\nLearning: ${(subscriber.profile.learningLanguages?.map(l => l.languageName + (l.level ? ` (${l.level})` : '')).join(', ') || 'Not set')}\nTimezone: ${subscriber.profile.timezone || 'Not set'}\nPremium: ${subscriber.isPremium ? 'Yes' : 'No'}\nLast Active: ${subscriber.lastActiveAt ? new Date(subscriber.lastActiveAt).toLocaleString() : 'Unknown'}`;
        await whatsappService.sendMessage(subscriber.connections.phone, info);
        return '!me';
    }

    if (message.startsWith('!profile')) {
        await whatsappService.sendMessage(subscriber.connections.phone, "To update your profile, please tell me your name, timezone, and when you would like to receive messages (morning, midday, evening or fixed times like 08:00). (Please write feedback if this does not work!)");
        return '!profile';
    }

    if (message.startsWith('!languages')) {
        const speaking = subscriber.profile.speakingLanguages?.map(l => l.languageName + (l.level ? ` (${l.level})` : '')).join(', ') || 'Not set';
        const learning = subscriber.profile.learningLanguages?.map(l => l.languageName + (l.level ? ` (${l.level})` : '')).join(', ') || 'Not set';
        await whatsappService.sendMessage(subscriber.connections.phone, `You are currently set as speaking: ${speaking}\nLearning: ${learning}\nTo update, just tell me your new languages! (If this does not work, please write feedback!)`);
        return '!languages';
    }

    if (message.startsWith('!feedback')) {
        await whatsappService.sendMessage(subscriber.connections.phone, "You can send feedback at any time by just messaging me! If you want to mark it as feedback, start your message with !feedback followed by your comments.");
        return '!feedback';
    }

    if (message.startsWith('!schedule')) {
        await whatsappService.sendMessage(subscriber.connections.phone, "Your current schedule preferences are not set. (This feature will be improved soon!)\nLet me know when you'd like to practice, and I'll remind you.");
        return '!schedule';
    }

    if (message.startsWith('!reset')) {
        await languageBuddyAgent.clearConversation(subscriber.connections.phone);
        await whatsappService.sendMessage(subscriber.connections.phone, "Your conversation has been reset.");
        return '!reset';
    }

    if (message.startsWith('!help') || message.startsWith('help') || message.startsWith('!commands')) {
      logger.info(`User ${subscriber.connections.phone} requested help`);
      await whatsappService.sendMessage(subscriber.connections.phone, 'Commands you can use:\n- "!help" or "!commands": Show this help menu\n- "!me": Show your current profile info\n- "!profile": Update your profile\n- "!languages": List or update your languages\n- "!feedback": Send feedback\n- "!schedule": Set or view your practice schedule\n- "!reset": Reset your conversation and profile\n- "!clear": Clear the current chat history\n- "ping": Test connectivity');
      return '!help';
    }

    return "nothing";
}

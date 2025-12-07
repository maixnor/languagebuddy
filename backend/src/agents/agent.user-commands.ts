import { Subscriber } from '../features/subscriber/subscriber.types';
import { logger } from '../config';
import { WhatsAppService } from '../core/messaging/whatsapp';
import { LanguageBuddyAgent } from './language-buddy-agent';
import { SubscriberService } from '../features/subscriber/subscriber.service';
import { SchedulerService } from '../features/scheduling/scheduler.service';

export async function handleUserCommand(
    subscriber: Subscriber, 
    message: string,
    whatsappService: WhatsAppService,
    languageBuddyAgent: LanguageBuddyAgent
) {
    if (message === 'ping' || message === '!ping') {
        await whatsappService.sendMessage(subscriber.connections.phone, "pong");
        return "ping";
    }

    if (message.startsWith('!clear')) {
        logger.info({ phone: subscriber.connections.phone }, "Handling !clear command.");
        logger.debug({ phone: subscriber.connections.phone }, "Calling clearConversation for !clear command.");
        await languageBuddyAgent.clearConversation(subscriber.connections.phone);
        await whatsappService.sendMessage(subscriber.connections.phone, "Conversation history cleared.");
        return '!clear';
    }

    if (message.startsWith('!digest')) {
        try {
            logger.info({ phone: subscriber.connections.phone }, "User requested manual digest creation");
            
            // Create digest using backend logic approach (not agent tools)
            const subscriberService = SubscriberService.getInstance();
            const digestCreated = await subscriberService.createDigest(subscriber);
            
            if (digestCreated) {
                await languageBuddyAgent.clearConversation(subscriber.connections.phone);
                await whatsappService.sendMessage(
                    subscriber.connections.phone, 
                    "📊 Conversation digest created! Your learning progress has been analyzed and saved to help personalize future conversations."
                );
            } else {
                await whatsappService.sendMessage(
                    subscriber.connections.phone, 
                    "There was a problem creating your digest. Please have a conversation first before creating a digest."
                );
            }

            return '!digest';
        } catch (error) {
            logger.error({ err: error, phone: subscriber.connections.phone }, "Error creating manual digest");
            await whatsappService.sendMessage(
                subscriber.connections.phone, 
                "Sorry, there was an error creating your digest. Please try again later."
            );
            return '!digest';
        }
    }

    if (message.startsWith('!night')) {
        try {
            logger.info({ phone: subscriber.connections.phone }, "User requested manual nightly tasks execution");
            
            const schedulerService = SchedulerService.getInstance();
            const messageSent = await schedulerService.executeNightlyTasksForSubscriber(subscriber);
            
            if (messageSent) {
                await whatsappService.sendMessage(
                    subscriber.connections.phone, 
                    "🌙 Nightly tasks executed! Your conversation has been digested, history cleared, and a new conversation has started."
                );
                logger.info({ phone: subscriber.connections.phone }, "Nightly tasks executed successfully via user command");
            } else {
                await whatsappService.sendMessage(
                    subscriber.connections.phone, 
                    "There was a problem executing nightly tasks. Please try again later."
                );
            }

            return '!night';
        } catch (error) {
            logger.error({ err: error, phone: subscriber.connections.phone }, "Error executing manual nightly tasks");
            await whatsappService.sendMessage(
                subscriber.connections.phone, 
                "Sorry, there was an error executing nightly tasks. Please try again later."
            );
            return '!night';
        }
    }

    if (message.startsWith('!me')) {
        // TODO implement one-shot requests
        // TODO let gpt handle this
        const info = `Your profile:\nName: ${subscriber.profile.name}\nSpeaking: ${(subscriber.profile.speakingLanguages?.map(l => l.languageName + (l.overallLevel ? ` (${l.overallLevel})` : '')).join(', ') || 'Not set')}\nLearning: ${(subscriber.profile.learningLanguages?.map(l => l.languageName + (l.overallLevel ? ` (${l.overallLevel})` : '')).join(', ') || 'Not set')}\nTimezone: ${subscriber.profile.timezone || 'Not set'}\nPremium: ${subscriber.isPremium ? 'Yes' : 'No'}\nLast Active: ${subscriber.lastActiveAt ? new Date(subscriber.lastActiveAt).toLocaleString() : 'Unknown'}`;
        await whatsappService.sendMessage(subscriber.connections.phone, info);
        return '!me';
    }

    if (message.startsWith('!profile')) {
        await whatsappService.sendMessage(subscriber.connections.phone, "To update your profile, please tell me your name, timezone, and when you would like to receive messages (morning, midday, evening or fixed times like 08:00). (Please write feedback if this does not work!)");
        return '!profile';
    }

    if (message.startsWith('!languages')) {
        const speaking = subscriber.profile.speakingLanguages?.map(l => l.languageName + (l.overallLevel ? ` (${l.overallLevel})` : '')).join(', ') || 'Not set';
        const learning = subscriber.profile.learningLanguages?.map(l => l.languageName + (l.overallLevel ? ` (${l.overallLevel})` : '')).join(', ') || 'Not set';
        // TODO let GPT handle that
        await whatsappService.sendMessage(subscriber.connections.phone, `You are currently set as speaking: ${speaking}\nLearning: ${learning}\nTo update, just tell me your new languages! (If this does not work, please write feedback!)`);
        return '!languages';
    }

    if (message.startsWith('!feedback')) {
        await whatsappService.sendMessage(subscriber.connections.phone, "You can send feedback at any time by just messaging me! If you want to mark it as feedback, start your message with !feedback followed by your comments.");
        return '!feedback';
    }

    if (message.startsWith('!schedule')) {
        await whatsappService.sendMessage(subscriber.connections.phone, `Your current preferences are: ${subscriber.profile.messagingPreferences?.times?.join(", ")}. (This feature will be improved soon!)\nLet me know when you'd like to practice, and I'll remind you.`);
        return '!schedule';
    }

    if (message.startsWith('!reset')) {
        await languageBuddyAgent.clearConversation(subscriber.connections.phone);
        await whatsappService.sendMessage(subscriber.connections.phone, "Your conversation has been reset.");
        return '!reset';
    }

    if (message.startsWith('!check')) {
        await whatsappService.sendMessage(subscriber.connections.phone, "Checking the last response... 🕵️");
        const result = await languageBuddyAgent.checkLastResponse(subscriber);
        
        let finalMessage = result;
        // If a mistake was found (indicated by the warning emoji/text from checkLastResponse), add the clear hint
        if (result.includes("⚠️") || result.includes("Mistake")) {
            finalMessage += "\n\n(If I keep making mistakes or hallucinations continue, you can use !clear to reset the conversation context.)";
        }
        
        await whatsappService.sendMessage(subscriber.connections.phone, finalMessage);
        return '!check';
    }

    if (message.startsWith('!help') || message.startsWith('help') || message.startsWith('!commands')) {
      logger.info(`User ${subscriber.connections.phone} requested help`);
      await whatsappService.sendMessage(subscriber.connections.phone, 'Commands you can use:\n- "!help" or "!commands": Show this help menu\n- "!me": Show your current profile info\n- "!profile": Update your profile\n- "!languages": List or update your languages\n- "!feedback": Send feedback\n- "!schedule": Set or view your practice schedule\n- "!reset": Reset your conversation and profile\n- "!clear": Clear the current chat history\n- "!check": Check the last AI response for mistakes\n- "!digest": Create a learning digest from current conversation\n- "!night": Manually trigger nightly tasks (digest + reset + new conversation)\n- "ping": Test connectivity');
      return '!help';
    }

    return "nothing";
}

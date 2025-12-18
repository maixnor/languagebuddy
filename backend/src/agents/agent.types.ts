import { BaseMessage } from "@langchain/core/messages";
import { Subscriber } from "../features/subscriber/subscriber.types";

export interface AgentState {
  messages: BaseMessage[];
  subscriber: Subscriber;
  activeMode: 'conversation' | 'feedback' | 'onboarding';
  subgraphState?: {
    messages: BaseMessage[];
    context?: Record<string, any>;
  } | null;
}

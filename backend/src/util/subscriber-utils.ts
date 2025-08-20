import { Language, Subscriber } from "../types";


export const getFirstLearningLanguage = (subscriber: Subscriber): Language => {
    return subscriber.profile.learningLanguages[0];
};
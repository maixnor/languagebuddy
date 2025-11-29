export interface OnboardingState {
  phone: string;
  gdprConsented: boolean;
  currentStep: 'gdpr_consent' | 'profile_gathering' | 'target_language' | 'explaining_features' | 'assessment_conversation' | 'completed';
  tempData?: {
    name?: string;
    nativeLanguages?: string[];
    targetLanguage?: string;
    assessmentStarted?: boolean;
    messagesInAssessment?: number;
    timezone?: string;
  };
}

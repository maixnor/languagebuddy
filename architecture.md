# Architecture for the Tour Guide App
## 1. Frontend
Technology: React.js
Purpose: User interface for customers to interact with the app, enter phone numbers, and start the tour.
## 2. Backend
Technology: Node.js with Express.js
Purpose: Handle API requests, manage game logic, and communicate with the GPT model.
## 3. Database
Technology: MongoDB (Managed by MongoDB Atlas)
Purpose: Store user data, game states, and tour information.
## 4. AI Integration
Technology: OpenAI GPT-4 API
Purpose: Provide game master functionality, generate riddles, and give hints.
## 5. Messaging Integration
Technology: Twilio API for WhatsApp
Purpose: Enable communication between the customer and the GPT game master via WhatsApp.
## 6. Payment Processing
Technology: Stripe
Purpose: Handle customer payments for the tour.

# Tours Project

Welcome to the Tours Project! This project is designed to help users find and book tours around the world.

## Installation

To get started with the Tours Project, follow these steps:

1. Clone the repository:
```bash
git clone https://github.com/maixnor/tours.git && cd tours
```
2. Install dependencies and Run the cli tester:

Use this mode for testing the backend. The Whatsapp API can only be configured to one endpoint at a time, so the CLI simulates a bad Whatsapp Server where the 
backend then sends the messages to the CLI instead of Whatsapp. This way you can test the backend without having to set up a Whatsapp API.
It saves into SQLite. Be aware of that.

In the CLI you can change the user phone number on the fly and test different users, if possible don't use live phone numbers to not alter the real users' conversations.

```bash
cd backend
npm install && npm run dev:cli
npm run cli
```

## Deployment

Deployment is handled automatically via GitHub Actions. When you push changes to the `main` branch, the application will be built and deployed to the production environment.

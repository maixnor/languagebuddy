// TWILIO for whatapp
const twilio = require('twilio');
const accountSid = 'your_account_sid';
const authToken = 'your_auth_token';
const client = new twilio(accountSid, authToken);

client.messages.create({
    body: 'Hello from your tour guide!',
    from: 'whatsapp:+14155238886',
    to: 'whatsapp:+your_customer_number'
})
.then(message => console.log(message.sid))
.catch(error => console.error(error));

// OpenAI GPT-4o for propmting
const { Configuration, OpenAIApi } = require('openai');
const configuration = new Configuration({
    apiKey: 'your_openai_api_key',
});
const openai = new OpenAIApi(configuration);

async function getGPTResponse(prompt) {
    const response = await openai.createCompletion({
        model: 'gpt-4',
        prompt: prompt,
        max_tokens: 150,
    });
    return response.data.choices[0].text.trim();
}
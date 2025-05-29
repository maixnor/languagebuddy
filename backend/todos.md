
# Time awareness

The conversation history should include timestamps when the user messages were received to have some awareness of time. i.e. GPT should be able to notice if 2 minutes or 2 hours have passed between messages

Also then I can end conversations over night and that works well too.

# Night time

Figure out time zone
Then with the time zone I can know when nighttime is and reset the conversation at 3 in the morning
then let GPT calculate a digest of the conversation, if it is with vocabulary save the specific vocabulary as well, so GPT can have a somewhat decent context over what happened the past days

# User probing

GPT should try to fill out all information missing in the specific subscriber object to have full information at all times

# verify user subscription

every night the covnersation history is cleared

only on initiating a new conversation the subscription status is checked, i.e. max once per day

# GPT initiated conversation

seek out random points in time to message the user with whatever short smalltalk you can think of, ideally about the topic the user is currently trying to learn
then get a first response from GPT and send that to the user

# Payment integration

figure out how this thing with the payment links works exactly, but I presume via the phone number in the form the phone field is populated so I can search for it later.

# Whatsapp behavior

add a logo and description to give the buddy a bit more personality
when the response from GPT is returned have a typing... status issued and wait based on the amount of words in the GPT response, the function should have a cap of 10s
ignore the typing when a user command is being handled

# User commands

translate
define

# GPT commands

does not work yet, but most of the code is written already, only need to debug


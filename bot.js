const TelegramBot = require('node-telegram-bot-api');
const { JsonDB } = require('node-json-db');
const { Config } = require('node-json-db/dist/lib/JsonDBConfig');
const Gpio = require("./gpio");

const secrets = require('./secrets.json');

console.log(`Starting Intercom Bot with:\nAdmin: ${secrets.admin}\nToken: ${secrets.token}`);

const db = new JsonDB(new Config("database", true, false, '/'));

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(secrets.token, {polling: true});

const door_gpio = new Gpio.Gpio(secrets.door_pin, Gpio.DIRECTION.OUTPUT);

bot.on("polling_error", (err) => console.log(err));

bot.onText(/\/start/, (msg) => {
    console.log(`Received /start from @${msg.chat.username} (${msg.chat.first_name} ${msg.chat.last_name})`);
    if(msg.chat.username == null) {
        bot.sendMessage(msg.chat.id, "Please, set an username in order to use this bot\nAfter that type /start again");
    } else {
        if(isAdmin(msg)) {
            db.push("/adminChatId", msg.chat.id);
            bot.sendMessage(msg.chat.id, "Hi Boss, how may I help you?");
        } else {
            try {
                const index = db.getIndex("/known_users", msg.chat.username);

                const user = db.getData(`/known_users[${index}]`);
                if(!user.adminNotified) {
                    const id = getAdminChatid();
                    if(id !== null) {
                        db.push(`/known_users[${index}]/adminNotified`, true);
                        bot.sendMessage(msg.chat.id, "Hi " + msg.chat.first_name + " " + msg.chat.last_name + ",\nSince I don't know who you are, I will ask my boss what to do...\nI will let you know what he'll decide.");
                        bot.sendMessage(id, `New User`);
                        sendUserSummary(id, user);
                    }
                } else {
                    bot.sendMessage(msg.chat.id, "My boss has been notified, just wait!");
                }

            } catch (error) {

                try {

                    db.getIndex(`/banned_users`, msg.chat.username);
                    bot.sendMessage(msg.chat.id, "Sorry, you have been banned.");

                } catch(error) {

                    bot.sendMessage(msg.chat.id, "Hi " + msg.chat.first_name + " " + msg.chat.last_name + ",\nSince I don't know who you are, I will ask my boss what to do...\nI will let you know what he'll decide.");
                
                    const id = getAdminChatid();

                    let user = {
                        id: msg.chat.username,
                        chatId: msg.chat.id,
                        name: msg.chat.first_name + (msg.chat.last_name != null ? " " + msg.chat.last_name: ""),
                        permissions: {
                            open: false,
                            notify: false
                        },
                        adminNotified: id !== null
                    }

                    db.push("/known_users[]", user);

                    if(id !== null) {
                        bot.sendMessage(id, `New User`);
                        sendUserSummary(id, user);
                    }

                }
                
            }
        }
    }
});

bot.onText(/\/users/, (msg) => {
    if(isAdmin(msg)) {

        var size = db.count(`/known_users`);
        if(size > 0) {
            for(var i = 0; i < size; i++) {
                sendUserSummary(msg.chat.id, db.getData(`/known_users[${i}]`));
            }
        } else {
            bot.sendMessage(msg.chat.id, "There are no users yet.");
        }
        

    } else {
        bot.sendMessage(msg.chat.id, "Not authorized.");
    }
});

bot.onText(/\/banned/, (msg) => {
    if(isAdmin(msg)) {

        var size = db.count(`/banned_users`);

        if(size > 0) {
            for(var i = 0; i < size; i++) {
                var user = db.getData(`/banned_users[${i}]`);
                bot.sendMessage(msg.chat.id, user.id, {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "Unban",
                                    callback_data: `/unban ${user.id}`
                                }
                            ]
                        ]
                    }
                });
            }
        } else {
            bot.sendMessage(msg.chat.id, "There are no banned users yet.");
        }

    } else {
        bot.sendMessage(msg.chat.id, "Not authorized.");
    }
});

bot.onText(/\/open/, async (msg) => {
    if(isAdmin(msg) || hasPremission(msg, "open")) {
        door_gpio.write(Gpio.VALUE.LOW);
        await sleep(2000);
        door_gpio.write(Gpio.VALUE.HIGH);
        bot.sendMessage(msg.chat.id, "Done.");
    } else {
        bot.sendMessage(msg.chat.id, "Unauthorized.");
    }
});

bot.on('callback_query', (query) => {

    let match;
  
    match = query.data.match(/\/permissions (.+)/);
    if(match) {

        if(isAdmin(query.message)) {

            let args = match[1].split(" ");
  
            let userid = args[0];
            let permission = args[1];
            let value = args[2] === '1';

            const index = db.getIndex("/known_users", userid);

            switch(permission) {
                case "open" :
                    db.push(`/known_users[${index}]/permissions/open`, value);
                    if(value) {
                        bot.sendMessage(db.getData(`/known_users[${index}]/chatId`), "You have been given \"Open\" permissions");
                    } else {
                        bot.sendMessage(db.getData(`/known_users[${index}]/chatId`), "You have been revoked \"Open\" permissions");
                    }
                    break;
                case "notify" :
                    db.push(`/known_users[${index}]/permissions/notify`, value);
                    if(value) {
                        bot.sendMessage(db.getData(`/known_users[${index}]/chatId`), "You have been given \"Notify\" permissions");
                    } else {
                        bot.sendMessage(db.getData(`/known_users[${index}]/chatId`), "You have been revoked \"Notify\" permissions");
                    }
                    break;
            }

            updateUserSummary(query.message, db.getData(`/known_users[${index}]`));

            bot.answerCallbackQuery(query.id);

        }
  
    }

    match = query.data.match(/\/delete (.+)/);
    if(match) {

        if(isAdmin(query.message)) {

            let args = match[1].split(" ");
  
            let userid = args[0];

            const index = db.getIndex("/known_users", userid);

            db.delete(`/known_users[${index}]`);

            bot.deleteMessage(query.message.chat.id, query.message.message_id);
            bot.sendMessage(query.message.chat.id, `User ${userid} succesfully deleted`);

        }
  
    }

    match = query.data.match(/\/ban (.+)/);
    if(match) {

        if(isAdmin(query.message)) {

            let args = match[1].split(" ");
  
            let userid = args[0];

            const index = db.getIndex("/known_users", userid);

            db.delete(`/known_users[${index}]`);
            db.push(`/banned_users[]`, {
                id: userid
            });

            bot.deleteMessage(query.message.chat.id, query.message.message_id);
            bot.sendMessage(query.message.chat.id, `User ${userid} succesfully banned`);

        }
  
    }

    match = query.data.match(/\/unban (.+)/);
    if(match) {

        if(isAdmin(query.message)) {

            let args = match[1].split(" ");
  
            let userid = args[0];

            const index = db.getIndex("/banned_users", userid);

            db.delete(`/banned_users[${index}]`);

            bot.deleteMessage(query.message.chat.id, query.message.message_id);
            bot.sendMessage(query.message.chat.id, `User ${userid} succesfully unbanned`);

        }
  
    }
  
  });

function userOptionsInlineKeyboard(user) {
    return [
        [
            !user.permissions.open ? {
                text: 'Give "Open" permission',
                callback_data: `/permissions ${user.id} open 1`
            } : {
                text: 'Revoke "Open" permission',
                callback_data: `/permissions ${user.id} open 0`
            }
        ],
        [
            !user.permissions.notify ? {
                text: 'Give "Notify" permission',
                callback_data: `/permissions ${user.id} notify 1`
            } : {
                text: 'Revoke "Notify" permission',
                callback_data: `/permissions ${user.id} notify 0`
            }
        ],
        [
            {
                text: 'Delete user',
                callback_data: `/delete ${user.id}`
            },
            {
                text: 'Ban user',
                callback_data: `/ban ${user.id}`
            }
        ]
    ];
}

function userSummary(user) {
    return `username: ${user.id}\nname: ${user.name}\n\nPermissions:\nopen: ${user.permissions.open ? "🟢 *active*" : "🔴 *not active*"}\nnotify: ${user.permissions.notify ? "🟢 *active*" : "🔴 *not active*"}`;
}

function sendUserSummary(chat_id, user) {
    bot.sendMessage(chat_id, userSummary(user), {
        parse_mode : "Markdown",
        reply_markup: {
            inline_keyboard: userOptionsInlineKeyboard(user)
        }
    });
}

function updateUserSummary(msg, user) {
    bot.editMessageText(userSummary(user), {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        parse_mode : "Markdown",
        reply_markup: {
            inline_keyboard: userOptionsInlineKeyboard(user)
        }
    });
}

function getAdminChatid() {
    try {
        return db.getData('/adminChatId');
    } catch (error) {
        return null;
    }
}

function hasPremission(msg, permission) {
    const username = msg.chat.username;
    try {
        const index = db.getIndex(`/known_users`, username);
        return db.getData(`/known_users[${index}]/permissions/${permission}`);
    } catch(error) {
        return false;
    }
}

function isAdmin(msg) {
    return msg.chat.username === secrets.admin;
}

function notifyOnline() {
    const id = getAdminChatid();
    if(id !== null) {
        bot.sendMessage(id, "Hey Boss! I'm online!");
    }
}

function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
}

notifyOnline();
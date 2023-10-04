const TelegramBot = require('node-telegram-bot-api');
const { JsonDB } = require('node-json-db');
const { Config } = require('node-json-db/dist/lib/JsonDBConfig');
const Gpio = require("./gpio");
const AudioController = require('./audio');
const path = require('path');
const fs = require('fs');
const startWebServer = require('./web/server');

const secrets = require('./secrets.json');
const gpio = require('./gpio');

console.log(`Starting Intercom Bot with:\nAdmin: ${secrets.admin}\nToken: ${secrets.token}`);

const db = new JsonDB(new Config("database", true, false, '/'));

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(secrets.token, {polling: true});

const door_gpio = new Gpio.GpioOUT(secrets.door_pin, Gpio.VALUE.HIGH);

const bell_pin = new Gpio.GpioIN(secrets.bell_pin, (value) => {
    if(value === gpio.VALUE.HIGH) {
        notifyBell();
    }
}, true);

const audio_gpios = secrets.audio_pins.map((pin) => new Gpio.GpioOUT(pin, Gpio.VALUE.HIGH));

const audio = new AudioController();

const custom_audio_files = fs.readdirSync(path.join(__dirname, "audio/custom"));

bot.on("polling_error", (err) => console.log(err));

bot.onText(/\/start/, (msg) => {
    console.log(`Received /start from @${msg.chat.username} (${msg.chat.first_name} ${msg.chat.last_name})`);
    if(msg.chat.username == null) {
        bot.sendMessage(msg.chat.id, "Please, set an username in order to use this bot\nAfter that type /start again");
    } else {
        if(isAdmin(msg)) {

            bot.sendMessage(msg.chat.id, "Hi Boss, how may I help you?");
            console.log(`User @${msg.chat.username} is the Admin`);

        } else {

            const user = getUserFromMsg(msg);

            if(user === null) {

                if(isUserBanned(msg.chat.username)) {
                    bot.sendMessage(msg.chat.id, "Sorry, you have been banned.");
                    console.log(`User @${msg.chat.username} was banned`);
                } else {

                    console.log(`User @${msg.chat.username} was NOT banned, sending welcome message`);

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

                    console.log(`Pushing user @${msg.chat.username} into /known_users collection`);

                    db.push("/known_users[]", user);

                    if(id !== null) {
                        bot.sendMessage(id, `New User`);
                        sendUserSummary(id, user);
                    }
                }

            } else {

                console.log(`User was NOT null, let's see if the admin has been already notified of this new user`);

                if(!user.adminNotified) {

                    console.log(`Admin was not yet notified of this user, sending notification...`);

                    const id = getAdminChatid();
                    if(id !== null) {
                        db.push(`/known_users[${index}]/adminNotified`, true);
                        bot.sendMessage(msg.chat.id, "Hi " + msg.chat.first_name + " " + msg.chat.last_name + ",\nSince I don't know who you are, I will ask my boss what to do...\nI will let you know what he'll decide.");
                        bot.sendMessage(id, `New User`);
                        sendUserSummary(id, user);
                    }
                } else {

                    console.log(`Admin had already been notified, not sending any notification!`);

                    bot.sendMessage(msg.chat.id, "My boss has been notified, just wait!");
                }

            }

        }
    }
});

bot.onText(/\/users/, (msg) => {
    if(isAdmin(msg)) {

        let size = 0;

        try {
            size = db.count(`/known_users`);
        } catch(err) {
            size = 0;
        }

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

bot.on('audio', (msg) => {
    handleAudio(msg);
});

bot.on('voice', (msg) => {
    handleAudio(msg);
});

bot.onText(/\/banned/, (msg) => {
    if(isAdmin(msg)) {

        let size = 0;

        try {
            size = db.count(`/banned_users`);
        } catch(err) {
            size = 0;
        }

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
        
        openTheDoor();

        bot.sendMessage(msg.chat.id, "Done.");

        if(!isAdmin(msg)) {
            const user = getUserFromMsg(msg);
            bot.sendMessage(getAdminChatid(), `User: *${user.name}* just opened the door.`, {
                parse_mode: "Markdown"
            });
        }
    } else {
        bot.sendMessage(msg.chat.id, "Unauthorized.");
    }
});

/* Test command that replaces the intercom trigger until i figure out hoe to detect that */
bot.onText(/\/test/, async (msg) => {
    if(isAdmin(msg)) {

        notifyBell();
        
    } else {
        bot.sendMessage(msg.chat.id, "Unauthorized.");
    }
});

bot.onText(/\/record/, async (msg) => {
    if(isAdmin(msg)) {

        if(!audio.busy) {

            audio_gpios.forEach((pin) => pin.write(gpio.VALUE.LOW));

            const message = await bot.sendMessage(msg.chat.id, "Recording audio...");

            const filename = "/tmp/record.mp3";
            const duration = 8;

            await audio.play("./audio/beep.ogg").catch(errorHandler);
            await audio.record(filename, duration).catch(errorHandler);

            audio_gpios.forEach((pin) => pin.write(gpio.VALUE.HIGH));

            bot.deleteMessage(message.chat.id, message.message_id);
            bot.sendAudio(msg.chat.id, filename);

        } else {
            bot.sendMessage(msg.chat.id, "Can't do that. Audio Controller is busy right now");
        }

    } else {
        bot.sendMessage(msg.chat.id, "Unauthorized.");
    }
});

/* Test command that replaces the intercom trigger until i figure out hoe to detect that */
bot.onText(/\/test/, async (msg) => {
    if(isAdmin(msg)) {

        notifyBell();
        
    } else {
        bot.sendMessage(msg.chat.id, "Unauthorized.");
    }
});

bot.on('callback_query', async (query) => {

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

    match = query.data.match(/\/not_at_home/);
    if(match) {

        if(isAdmin(query.message)) {

            const tmp = await bot.sendMessage(query.message.chat.id, "Playing \"I'm not at home, leave a message\"...");
        
            if(!audio.busy) {

                audio_gpios.forEach((pin) => pin.write(gpio.VALUE.LOW));
            
                await audio.play("./audio/not_at_home.ogg").catch(errorHandler);
                await audio.play("./audio/beep.ogg").catch(errorHandler);

                bot.editMessageText("Played. \"I'm not at home, leave a message\"", {
                    chat_id: tmp.chat.id,
                    message_id: tmp.message_id
                });

                const message = await bot.sendMessage(query.message.chat.id, "Recording response...");

                const filename = "/tmp/record.mp3";
                const duration = 6;

                await audio.record(filename, duration).catch(errorHandler);

                audio_gpios.forEach((pin) => pin.write(gpio.VALUE.HIGH));

                bot.deleteMessage(message.chat.id, message.message_id);
                bot.sendAudio(query.message.chat.id, filename);

            } else {
                bot.sendMessage(query.message.chat.id, "Can't do that. Audio Controller is busy right now");
            }

        }

    }

    match = query.data.match(/\/call_me/);
    if(match) {

        if(isAdmin(query.message)) {

            const tmp = await bot.sendMessage(query.message.chat.id, "Playing \"Call me\"...");
        
            if(!audio.busy) {

                audio_gpios.forEach((pin) => pin.write(gpio.VALUE.LOW));
                await audio.play("./audio/call_me.ogg").catch(errorHandler);
                audio_gpios.forEach((pin) => pin.write(gpio.VALUE.HIGH));
    
                bot.editMessageText("Played. \"Call me\"", {
                    chat_id: tmp.chat.id,
                    message_id: tmp.message_id
                });

            } else {
                bot.sendMessage(query.message.chat.id, "Can't do that. Audio Controller is busy right now");
            }

        }
  
    }

    match = query.data.match(/\/package_inside/);
    if(match) {

        if(isAdmin(query.message)) {

            const tmp = await bot.sendMessage(query.message.chat.id, "Playing \"Leave the package inside\"...");
        
            if(!audio.busy) {
                
                audio_gpios.forEach((pin) => pin.write(gpio.VALUE.LOW));
                await audio.play("./audio/leave_the_package_inside.ogg").catch(errorHandler);
                audio_gpios.forEach((pin) => pin.write(gpio.VALUE.HIGH));
    
                bot.editMessageText("Played. \"Leave the package inside\"", {
                    chat_id: tmp.chat.id,
                    message_id: tmp.message_id
                });
    
                openTheDoor();

            } else {
                bot.sendMessage(query.message.chat.id, "Can't do that. Audio Controller is busy right now");
            }

        }
  
    }

    match = query.data.match(/\/custom_audio (.+)/);
    if(match) {

        if(isAdmin(query.message)) {

            let args = match[1].split(" ");
            let filename = args[0];

            const tmp = await bot.sendMessage(query.message.chat.id, `Playing "${filename}"...`);
        
            if(!audio.busy) {
                
                audio_gpios.forEach((pin) => pin.write(gpio.VALUE.LOW));
                await audio.play(path.join(__dirname, `audio/custom/${filename}`)).catch(errorHandler);
                audio_gpios.forEach((pin) => pin.write(gpio.VALUE.HIGH));
    
                bot.editMessageText(`Played. "${filename}"`, {
                    chat_id: tmp.chat.id,
                    message_id: tmp.message_id
                });

            } else {
                bot.sendMessage(query.message.chat.id, "Can't do that. Audio Controller is busy right now");
            }

        }
  
    }
  
  });

function notifyBell() {

    bot.sendMessage(getAdminChatid(), "🔔🔔🔔🔔🔔🔔🔔🔔🔔🔔", {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [ {
                    text: "I'm not at home, leave a message",
                    callback_data: "/not_at_home"
                } ],
                [ {
                    text: "Call me",
                    callback_data: "/call_me"
                } ],
                [ {
                    text: "Leave the package inside",
                    callback_data: "/package_inside"
                } ]
            ].concat(custom_audio_files.map((file) => [
                {
                    text: file,
                    callback_data: `/custom_audio ${file}`
                }
            ]))
        }
    });

}

function errorHandler(error) {
    bot.sendMessage(getAdminChatid(), `Error: ${error}`);
}

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

async function openTheDoor() {

    door_gpio.write(Gpio.VALUE.LOW);
    await sleep(200);
    door_gpio.write(Gpio.VALUE.HIGH);

    await sleep(50);

    door_gpio.write(Gpio.VALUE.LOW);
    await sleep(100);
    door_gpio.write(Gpio.VALUE.HIGH);

    await sleep(50);

    door_gpio.write(Gpio.VALUE.LOW);
    await sleep(100);
    door_gpio.write(Gpio.VALUE.HIGH);

    await sleep(50);

    door_gpio.write(Gpio.VALUE.LOW);
    await sleep(200);
    door_gpio.write(Gpio.VALUE.HIGH);

    await sleep(50);

    door_gpio.write(Gpio.VALUE.LOW);
    await sleep(300);
    door_gpio.write(Gpio.VALUE.HIGH);

    await sleep(150);

    door_gpio.write(Gpio.VALUE.LOW);
    await sleep(200);
    door_gpio.write(Gpio.VALUE.HIGH);

    await sleep(50);

    door_gpio.write(Gpio.VALUE.LOW);
    await sleep(500);
    door_gpio.write(Gpio.VALUE.HIGH);

}

async function handleAudio(msg) {

    if(isAdmin(msg)) {
        
        let fileid = null;

        if(msg.audio != null) {
            fileid = msg.audio.file_id;
        } else if(msg.voice != null) {
            fileid = msg.voice.file_id;
        }

        if(fileid !== null) {

            if(!audio.busy) {

                const message = await bot.sendMessage(msg.chat.id, "Downloading file...");

                const filePath = `/tmp/`;
                const fileName = await bot.downloadFile(fileid, filePath);
    
                bot.editMessageText('Playing...', {
                    chat_id: message.chat.id,
                    message_id: message.message_id
                });
    
                audio_gpios.forEach((pin) => pin.write(gpio.VALUE.LOW));
                await audio.play(fileName).catch(errorHandler);
                await audio.play('./audio/beep.ogg').catch(errorHandler);

                bot.editMessageText('Recording response...', {
                    chat_id: message.chat.id,
                    message_id: message.message_id
                });

                const responseFilePath = '/tmp/record.mp3';
                const duration = 6;

                await audio.record(responseFilePath, duration).catch(errorHandler);

                bot.deleteMessage(message.chat.id, message.message_id);
                bot.sendAudio(msg.chat.id, responseFilePath);

                await audio.play('./audio/beep.ogg').catch(errorHandler);

                audio_gpios.forEach((pin) => pin.write(gpio.VALUE.HIGH));

            } else {
                bot.sendMessage(query.message.chat.id, "Can't do that. Audio Controller is busy right now");
            }

        }

    } else {
        bot.sendMessage(msg.chat.id, "Not authorized.");
    }
}

function getUserFromMsg(msg) {

    try {
        const index = db.getIndex("/known_users", msg.chat.username);
        if(index < 0) {
            return null;
        } else {
            return db.getData(`/known_users[${index}]`);
        }
    } catch (error) {
        return null;
    }

}

function isUserBanned(username) {
    
    try {
        const index = db.getIndex("/banned_users", username);
        if(index < 0) {
            return false;
        } else {
            return true;
        }
    } catch (error) {
        return false;
    }

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
    if(username != null) {
        try {
            const index = db.getIndex(`/known_users`, username);
            return db.getData(`/known_users[${index}]/permissions/${permission}`);
        } catch(error) {
            return false;
        }
    }
}

function isAdmin(msg) {
    if(msg.chat.username === secrets.admin) {
        db.push("/adminChatId", msg.chat.id);
        return true;
    }
    return false;
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

if(secrets.webserver) {

    startWebServer(secrets.https_port, secrets.webtoken, (action) => {

        bot.sendMessage(getAdminChatid(), `Webhook action *"${action}"* was just triggered`, { parse_mode: "Markdown" });

        switch(action) {
            case "open":
                openTheDoor();
                break;
        }
    });

}

notifyOnline();

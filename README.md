# intercom-bot
Telegram bot that manages a traditional, old school, intercom

## Configuration

- Create a telegram bot and get the token
- If you want telegram to autocomplete commands, send this message to botfather when asked:
  ```
  users - List bot users
  banned - List banned users
  open - Open the door
  ```
- Create a user named `intercombot`
  ```
  useradd --create-home intercombot
  ```
- Clone this repo in the ssh bot's home folder (`/home/intercombot`)
- Create the config file `/home/intercombot/intercom-bot/secrets.json`
  ```
  {
    "token" : "YOUR_TOKEN_HERE",
    "admin" : "YOUR_TELEGRAM_USERNAME_HERE",
    "door_pin" : PIN_NUMBER_HERE,
    "speaker_pin": PIN_NUMBER_HERE,
    "mic_pin": PIN_NUMBER_HERE
  }
  ```
  Where:
  - `token` is the bot token provided by the botfather,
  - `admin` is your telegram username
  - `door_pin` is the gpio pin number that will trigger the door opening
  - `speaker_pin` is the gpio pin number that will trigger the speaker relay
  - `mic_pin` is the gpio pin number that will trigger the microphone relay
- Run `npm install` in the project folder
- Allow him to run the tee command as root without a password, run `visudo` and add this line at the end of that file, where N1, N2, ... are the gpio pin numbers that you will be using (the ones that are specified in `the secrets.json` file)
  ```
  intercombot ALL= NOPASSWD: /usr/bin/tee /sys/class/gpio/export, /usr/bin/tee /sys/class/gpio/gpioN1/value, /usr/bin/tee /sys/class/gpio/gpioN1/direction, /usr/bin/tee /sys/class/gpio/gpioN2/value, /usr/bin/tee /sys/class/gpio/gpioN3/direction, ...
  ```
  This allows him to kick ssh connections if needed, reboot the system and start/stop sshd service
- Create the service file `/lib/systemd/system/intercom-bot.service`
  ```
  [Unit]
  Description=INTERCOM telegram bot.

  [Service]
  Type=simple
  User=intercombot
  WorkingDirectory=/home/intercombot/intercom-bot
  ExecStart=/usr/bin/node bot.js
  Restart=on-failure
  RestartSec=5s

  [Install]
  WantedBy=multi-user.target
  ```
- Reload systemd services with
  ```
  systemctl daemon-reload
  ```
- Enable and start the newly created service (and check its status)
  ```
  systemctl enable intercom-bot
  systemctl start intercom-bot
  systemctl status intercom-bot
  ```

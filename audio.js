const { exec } = require('child_process');
const { access } = require('fs');

class AudioController {
    
    constructor(speaker_name, speaker_volume, microphone_name, microphone_volume) {

        this.speaker_name = speaker_name;
        this.speaker_volume = speaker_volume;
        this.microphone_name = microphone_name;
        this.microphone_volume = microphone_volume;

        exec(`pulseaudio -D`, (err, stdout, stderr) => {
            exec(`pacmd set-default-sink ${speaker_name}`, (err, stdout, stderr) => {
                if(err) {
                    throw `Exec error: ${stderr}`;
                }
    
                exec(`pacmd set-sink-volume ${speaker_name}, ${speaker_volume}`, (err, stdout, stderr) => {
                    if(err) {
                        throw `Exec error: ${stderr}`;
                    }
                });
            });
    
            exec(`pacmd set-default-source ${microphone_name}`, (err, stdout, stderr) => {
                if(err) {
                    throw `Exec error: ${stderr}`;
                }
    
                exec(`pacmd set-source-volume ${microphone_name}, ${microphone_volume}`, (err, stdout, stderr) => {
                    if(err) {
                        throw `Exec error: ${stderr}`;
                    }
                });
            });
        })

    }

    play(filename) {
        return new Promise((resolve, reject) => {
            exec(`mpv --no-video ${filename}`, (err, stdout, stderr) => {
                if(err) {
                    reject(stderr);
                } else {
                    resolve();
                }
            })
        });
    }

}

exports.AudioController = AudioController;
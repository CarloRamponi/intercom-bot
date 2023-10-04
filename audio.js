const { exec } = require('child_process');
const { access } = require('fs');

class AudioController {

    constructor() {
        this.busy = false;
    }
    
    play(filename) {
        return new Promise((resolve, reject) => {
            if(this.busy) {
                reject("Audio Controller is busy");
            } else {
                this.busy = true;
                exec(`mpv --no-video ${filename}`, (err, stdout, stderr) => {
                    this.busy = false;
                    if(err) {
                        reject(stderr);
                    } else {
                        resolve();
                    }
                })
            }
            
        });
    }

    record(filename, duration) {
        return new Promise((resolve, reject) => {
            if(this.busy) {
                reject("Audio Controller is busy");
            } else {
                this.busy = true;
                exec(`arecord -f cd -c 1 -d ${duration} -t raw | lame -r -m m - ${filename}`, (err, stdout, stderr) => {
                    this.busy = false;
                    if(err) {
                        reject(stderr);
                    } else {
                        resolve();
                    }
                })
            }
        })
    }

}

module.exports = AudioController;

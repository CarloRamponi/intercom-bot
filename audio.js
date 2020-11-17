const { exec } = require('child_process');
const { access } = require('fs');

class AudioController {
    
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

    record(filename, duration) {
        return new Promise((resolve, reject) => {
            exec(`arecord -f cd -c 1 -d ${duration} -t raw | oggenc - -r -o ${filename}`, (err, stdout, stderr) => {
                if(err) {
                    reject(stderr);
                } else {
                    resolve();
                }
            })
        })
    }

}

exports.AudioController = AudioController;
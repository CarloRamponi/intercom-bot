const { exec } = require('child_process');

const DIRECTION = {
    OUTPUT: 0,
    INPUT: 0
};

const VALUE = {
    HIGH: 1,
    LOW: 0
};

class Gpio {

    constructor(pin, direction, def) {
        
        this.pin = pin;
        this.direction = direction;

        //create gpio
        exec(`echo ${pin} | sudo tee /sys/class/gpio/export`);

        //set pin direction
        exec(`echo ${direction == DIRECTION.OUTPUT ? "out" : "in"} | sudo tee /sys/class/gpio/gpio${pin}/direction`);
        
    }

    write(value) {
        if(this.direction == DIRECTION.OUTPUT) {
            exec(`echo ${value == VALUE.HIGH? "1" : "0"} | sudo tee /sys/class/gpio/gpio${this.pin}/value`)
        } else {
            throw "Can't wirte on a GPIO PIN that is not set to OUTPUT";
        }
    }

    read() {
        return new Promise((resolve, reject) => {
            exec(`cat /sys/class/gpio/gpio${this.pin}/value`, (err, stdout, stderr) => {
                if(err) {
                    reject(stderr);
                } else {
                    if(stdout == "1") {
                        resolve(VALUE.HIGH);
                    } else {
                        resolve(VALUE.LOW);
                    }
                }
            })
        })
    }

};

exports.Gpio = Gpio;
exports.DIRECTION = DIRECTION;
exports.VALUE = VALUE;
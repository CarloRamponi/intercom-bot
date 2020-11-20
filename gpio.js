const { exec } = require('child_process');
const { access } = require('fs');
const { resolve } = require('path');
const { stderr } = require('process');

const VALUE = {
    HIGH: 1,
    LOW: 0
};

class GpioOUT {

    constructor(pin, value) {
        
        this.pin = pin;
        this.value = value !== null ? value : VALUE.LOW;

        //create gpio, set direction and set default value
        exec(`echo ${pin} | sudo tee /sys/class/gpio/export; echo out | sudo tee /sys/class/gpio/gpio${pin}/direction; echo ${this.value} | sudo tee /sys/class/gpio/gpio${pin}/value`, (err, stdout, stderr) => {
            if(err) {
                throw `GPIO ERROR: ${stderr}`;
            }
        });
        
    }

    write(value) {

        if(value != this.value) {
            this.value = value;

            exec(`echo ${this.value} | sudo tee /sys/class/gpio/gpio${this.pin}/value`, (err, stdout, stderr) => {
                if(err) {
                    throw `GPIO ERROR: ${stderr}`;
                }
            });

        }

    }

};

class GpioIN {

    constructor(pin, onChange, activeListen) {
        
        this.pin = pin;
        this.onChange = onChange;
        this.activeListen = activeListen;
        this.value = VALUE.LOW;

        //create gpio, set direction and set default value
        exec(`echo ${this.pin} | sudo tee /sys/class/gpio/export; echo in | sudo tee /sys/class/gpio/gpio${this.pin}/direction`, (err, stdout, stderr) => {
            if(err) {
                throw `GPIO ERROR: ${stderr}`;
            }
        });

        if(activeListen === true) {
            this._listen();
        }
        
    }

    async _listen() {

        while(true) {

            const value = await new Promise((resolve, reject) => {
                /** this loop with sleep 0.15 will take from 1.0% to 2.0% of CPU usage */
                exec(`while [ $(cat /sys/class/gpio/gpio${this.pin}/value) = "${this.value}" ]; do sleep 0.10; done;`, (err, stdout, stderr) => {
                    if(err) {
                        reject(`GPIO ERROR: ${stderr}`);
                    } else {
                        resolve(1 - this.value);
                    }
                })
            })
            
            this.value = value;
            if(this.onChange !== null) {
                this.onChange(value, this);
            }

        }

    }

    read() {
        if(this.activeListen === true) {
            return new Promise((resolve, reject) => resolve(this.value));
        } else {
            return new Promise((resolve, reject) => {
                exec(`cat /sys/class/gpio/gpio10/value`, (err, stdout, stderr) => {
                    if(err) {
                        reject(`GPIO ERROR: ${stderr}`);
                    }

                    resolve(parseInt(stdout));
                    
                });
            });
        }
    }

}

module.exports = {
    GpioOUT,
    GpioIN,
    VALUE
}
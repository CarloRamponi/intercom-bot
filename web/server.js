const https = require('https');
const express = require('express');
const fs = require('fs');

module.exports = function(PORT, TOKEN, success_callback) {

    const options = {
        key: fs.readFileSync(__dirname + '/key.pem'),
        cert: fs.readFileSync(__dirname + '/cert.pem')
    };

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.post('/', (req, res) => {
        
        const token = req.body.token;

        if(token) {

            if(token === TOKEN) {
                const action = req.body.action;
                success_callback(action);
                res.sendStatus(200);
            } else {
                res.sendStatus(400);
            }

        } else {
            res.sendStatus(400);
        }

    });

    app.use((req, res) => {
        res.sendStatus(404);
    });

    https.createServer(options, app).listen(PORT);

}
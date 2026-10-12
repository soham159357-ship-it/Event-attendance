// server.js - standalone event attendance app
const express = require('express');
const app = express();

app.use(express.json());
app.use(require('./eventRoutes'));

// Send the home page to the event form
app.get('/', (req, res) => res.redirect('/event'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Event attendance app running on port ${PORT}`));

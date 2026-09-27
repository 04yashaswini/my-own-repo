require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure the JSON data store and upload folder exist before the app starts.
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const ITEMS_FILE = path.join(DATA_DIR, 'gallery_items.json');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');

for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
for (const file of [ITEMS_FILE, ACTIVITY_FILE]) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, '[]', 'utf8');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const appRouter = require('./routes/app');
app.use('/', appRouter);

// 404
app.use((req, res) => {
  res.status(404).render('app', {
    page: 'error',
    errorCode: 404,
    errorMessage: 'Page not found.'
  });
});

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);
  const isProd = process.env.NODE_ENV === 'production';
  res.status(err.status || 500).render('app', {
    page: 'error',
    errorCode: err.status || 500,
    errorMessage: isProd ? 'Something went wrong.' : (err.message || 'Something went wrong.')
  });
});

app.listen(PORT, () => {
  console.log(`Nano Space running at http://localhost:${PORT}`);
});

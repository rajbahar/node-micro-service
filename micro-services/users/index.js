const express = require('express')
const app = express()
const port = 8001

app.get('/', (req, res) => {
  res.send('Hello user!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
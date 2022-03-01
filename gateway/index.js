
const proxy = require('express-http-proxy');

module.exports=function(app){

  app.use('/', proxy('http://localhost:8001/'))
  app.use('/user', proxy('http://localhost:8001/'))
  app.use('/post', proxy('http://localhost:8002/'))
  
}
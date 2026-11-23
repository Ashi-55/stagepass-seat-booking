let startup;
module.exports = async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  if(!process.env.DATABASE_URL){
    return res.status(503).json({message:'Booking is waiting for the hosted database connection.'});
  }
  let app;
  try{
    const {createApp}=require('../server.cjs');
    startup ??= createApp().then(async instance=>{await instance.init();return instance;});
    app=await startup;
  }catch{
    startup=undefined;
    return res.status(503).json({message:'The booking database is unavailable.'});
  }
  const url=new URL(req.url,'http://localhost');
  const operation=url.searchParams.get('operation')??url.pathname.split('/').pop();
  req.url='/api/'+encodeURIComponent(operation);
  return app.getHttpAdapter().getInstance()(req,res);
};

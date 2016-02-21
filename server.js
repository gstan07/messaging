require('newrelic');
var express = require('express');
var app = express();
var server = require('http').createServer(app);
var redisobj = require('redis')
var redis = redisobj.createClient(process.env.REDIS_URL);
var io = require('socket.io')(server,{
	// 'pingInterval': 360000,
	// 'pingTimeout': 360000
});

var port = process.env.PORT;

app.use('/', express.static(__dirname + '/public'));
server.listen(port, function() { console.log('listening on port: '+port)});

var allowed_keys = {
	"plmplmplm":{
		allowed_hosts:["localhost:3000","flirting.chat","www.flirting.chat"]
	}
}
var default_connection = io.use(function(socket,next){
	var handshake = socket.handshake.query;
	var host = socket.handshake.headers.host;
	var client_key = handshake.app_key;
	var handshake_error = "";
	if(allowed_keys[client_key].allowed_hosts.indexOf(host) == -1){
		handshake_error = "invalid app key";		
	}
	if(handshake_error == ""){
		next();
	}else{
		next(new Error(handshake_error));	
	}	
});
//opening a global connection
default_connection.once('connection', function(socket){
	//switching to specific namespace
	var nsp = io.of("/"+socket.handshake.query.app_key);

	nsp.on("connection",function(socket){
		socket.on("subscribe",function(data,callback){
			//joining room
			try{
				var total_rooms = data.channel.length;
				for(i = 0; i <= total_rooms; i++){
					if(i<total_rooms){
						socket.join(data.channel[i]);
					}else{
						socket.join(data.channel[i],function(){
							callback("Success, user connected to channel:"+data.channel)
						});	
					}
					
				}
				//broadcast join event to all the users but current
				if(data.broadcast_presence){			
					socket.broadcast.emit('presence',{
						action:"join",
						user:socket.state,
						// occupancy:Object.keys(nsp.connected).length
					});
				}
			}catch(err){
				console.log("error subscribing",err);
			}
		});


		socket.on("invitation",function(invitation,callback){
			for(i in nsp.sockets){
				var target_socket = nsp.sockets[i];
				if(target_socket.state.name == invitation.partner){
					nsp.sockets[target_socket.id].emit("invitation",invitation,function(){
						callback("invitation sent to "+target_socket.state.name)
					});
				}
			}
		});


		socket.on("state",function(data){
			//only emit if changed
			var shouldEmitState = false;
			if(typeof(socket.state) == "undefined"){
				shouldEmitState = true;
			}else if(JSON.stringify(socket.state) != JSON.stringify(data)){
				shouldEmitState = true;
			}
			if(shouldEmitState){
				socket["state"] = data;
				nsp.emit("state",data);
			}
			
		});


	 	socket.on("disconnect",function(){
	 		try{
	 			// console.log("disconnected",socket.id);
	 			nsp.emit("presence",{
					action:"leave",
					user:socket.state,
					// occupancy:Object.keys(nsp.connected).length
				})
			}catch(err){
				console.log("error emitting leave event",err);
			}
	 	});


	 	socket.on("user_list",function(data,callback){
	 		try{
		 		var room = data.channel;
		 		var users = [];
		 		
				for(var id in nsp.connected){
					if(nsp.connected[id].rooms[room]){
						users.push(nsp.connected[id].state)	
					}
				}
				callback(users);	
	 		}catch(err){
	 			console.log("error getting user list",err);
	 		}
	 		
	 	});


	 	socket.on("message",function(data,callback){
	 		//send the message to all sockets in the room, including sender
	 		try{
	 			nsp.in(data.channel).emit("message",data);
	 			redis.rpush(socket.handshake.query.app_key+"/"+data.channel, JSON.stringify(data));
	    		redis.ltrim(socket.handshake.query.app_key+"/"+data.channel, 0, 99);
	    		redis.expire(socket.handshake.query.app_key+"/"+data.channel,24*3600);
		 	}catch(err){
		 		console.log("error broadcasting message ",err);	
		 	}
	 	});


	 	socket.on("history",function(query,callback){
	 		try{
	 			var query = {
	 				channels:query.channels,
	 				limit:query.limit || 100
	 			}
	 			var response = [];
	 			var total_channels = query.channels.length;
	 			for(i=0; i<=total_channels; i++){
	 				if(i < total_channels){
	 					redis.lrange(socket.handshake.query.app_key+"/"+query.channels[i],0,query.limit-1,function(err,reply){
			 				if(!err){
			 					for(var j in reply){
			 						response.push(JSON.parse(reply[j]));
			 					}
			 				}
		 				})	
	 				}else{
	 					redis.lrange(query.channels[i],0,query.limit-1,function(err,reply){
			 				if(!err){
			 					for(var j in reply){
			 						response.push(JSON.parse(reply[j]));
			 					}
			 					callback(response);
			 				}
		 				})	
	 				}
	 			}
	 		}catch(err){
	 			console.log("error getting history",err)
	 		}
	 	});

	 	socket.on("seen",function(data,callback){
	 		try{
	 			for(i in nsp.sockets){
					var target_socket = nsp.sockets[i];
					if(target_socket.state.name == data.sender){
						nsp.sockets[target_socket.id].emit("seen",data,function(){
							callback("Seen event emited to "+target_socket.state.name)
						});
					}
				}
	 		}catch(err){
	 			console.log(err);
	 		}
	 	});

	})
});

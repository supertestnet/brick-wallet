// dependencies:
// https://supertestnet.github.io/bankify/super_nostr.js
// https://unpkg.com/@cmdcode/tapscript@1.5.3
// https://bundle.run/noble-secp256k1@1.2.14
var chain_client = {
    connection_info: null,
    most_recent_fulfilled_command: null,
    // base_url: `https://supertestnet.github.io/testnet_generator/`,
    base_url: `file:///home/supertestnet/bitcoin_projects/testnet_generator/testnet_generator.html`,
    main_connection: null,
    getPrivkey: () => window.crypto.getRandomValues( new Uint8Array( 32 ) ).toHex(),
    getPubkey: privkey => nobleSecp256k1.getPublicKey( privkey, true ).substring( 2 ),
    hexToBytes: hex => Uint8Array.from( hex.match( /.{1,2}/g ).map( byte => parseInt( byte, 16 ) ) ),
    bytesToHex: bytes => bytes.reduce( ( str, byte ) => str + byte.toString( 16 ).padStart( 2, "0" ), "" ),
    reverseHexString: s => s.match( /[a-fA-F0-9]{2}/g ).reverse().join( '' ),
    waitSomeTime: num => new Promise( resolve => setTimeout( resolve, num ) ),
    textToHex: text => {
        var encoded = new TextEncoder().encode( text );
        return Array.from( encoded )
            .map( x => x.toString( 16 ).padStart( 2, "0" ) )
            .join( "" );
    },
    sha256: async s => {
        if ( typeof s == "string" ) s = new TextEncoder().encode( s );
        var arr = await crypto.subtle.digest( 'SHA-256', s );
        return chain_client.bytesToHex( new Uint8Array( arr ) );
    },
    getNetworkUrl: ( privkey, relays ) => {
        var hex_relays = chain_client.textToHex( JSON.stringify( relays ) );
        return `${chain_client.base_url}#privkey=${privkey}#relays=${hex_relays}`;
    },
    createNetwork: async relays => {
        return new Promise( async resolve => {
            var privkey = chain_client.getPrivkey();
            var say_when_connected = chain_client.getPrivkey();
            var pubkey = chain_client.getPubkey( privkey );
            var hex_relays = chain_client.textToHex( JSON.stringify( relays ) );
            var iframe = document.createElement( "iframe" );
            // iframe.src = `${chain_client.base_url}#privkey=${privkey}#relays=${hex_relays}#say_when_connected=${say_when_connected}`;
            iframe.src = `${chain_client.base_url}#privkey=${privkey}#relays=${hex_relays}#say_when_connected=${say_when_connected}`;
            iframe.style.display = "none";
            iframe.className = `chain_client_network_${privkey}`;
            document.body.append( iframe );
            var network_string = `${pubkey},${relays[ 0 ]}`;

            //return info when testnet is ready for commands
            var listenFunction = async socket => {
                var subId = super_nostr.bytesToHex( crypto.getRandomValues( new Uint8Array( 8 ) ) );
                var filter  = {}
                filter.kinds = [ 54091 ];
                filter.authors = [ pubkey ];
                filter[ "#e" ] = [ say_when_connected ];
                var subscription = [ "REQ", subId, filter ];
                socket.send( JSON.stringify( subscription ) );
            }
            var handleFunction = async message => {
                var [ type, subId, event ] = JSON.parse( message.data );
                if ( !event || event === true ) return;
                chain_client.connection_info = [ privkey, network_string ];
                resolve( [ privkey, network_string ] );
            }
            var connection_id = await super_nostr.newPermanentConnection( relays[ 0 ], listenFunction, handleFunction );
            chain_client.main_connection = connection_id;

            //shut down
            var loop = async () => {
                if ( chain_client.connection_info ) {
                    super_nostr.sockets[ connection_id ].socket.close();
                    delete super_nostr.sockets[ connection_id ];
                    return chain_client.connection_info = null;
                }
                await chain_client.waitSomeTime( 1_000 );
                return loop();
            }
            loop();
        });
    },
    loadNetwork: async ( privkey, network_string ) => {
        return new Promise( async resolve => {
            var [ pubkey, relay ] = network_string.split( "," );
            var relays = [ relay ];
            var hex_relays = chain_client.textToHex( JSON.stringify( relays ) );
            var iframe = document.createElement( "iframe" );
            // if ( privkey ) iframe.src = `${chain_client.base_url}#privkey=${privkey}#relays=${hex_relays}#say_when_connected=${say_when_connected}`;
            // else iframe.src = `${chain_client.base_url}#pubkey=${pubkey}#relays=${hex_relays}#say_when_connected=${say_when_connected}`;
            if ( privkey ) iframe.src = `${chain_client.base_url}#privkey=${privkey}#relays=${hex_relays}`;
            else iframe.src = `${chain_client.base_url}#pubkey=${pubkey}#relays=${hex_relays}`;
            iframe.style.display = "none";
            iframe.className = `chain_client_network_${privkey || pubkey}`;
            document.body.append( iframe );

            //return info when testnet is ready for commands
            var loop = async () => {
                var commander = chain_client.createCommander( network_string.split( "," ) );
                var test = await commander( "rawtx", "a".repeat( 64 ) );
                if ( test === "tx not found" && privkey ) return resolve( [ privkey, network_string ] );
                if ( test === "tx not found" ) return resolve( [ null, network_string ] );
                await chain_client.waitSomeTime( 1_000 );
                loop();
            }
            await loop();
        });
    },
    createCommander: network => {
        var [ miner, relay ] = network;
        var commander = async ( command, params ) => {
            //prepare requisite variables
            var privkey = super_nostr.getPrivkey();
            var pubkey = super_nostr.getPubkey( privkey );
            var item_listened_for = null;

            //establish connection to relay
            var listenFunction = async socket => {
                var subId = super_nostr.bytesToHex( crypto.getRandomValues( new Uint8Array( 8 ) ) );
                var filter  = {}
                filter.kinds = [ 4 ];
                filter[ "#p" ] = [ pubkey ];
                filter.since = Math.floor( Date.now() / 1000 );
                var subscription = [ "REQ", subId, filter ];
                socket.send( JSON.stringify( subscription ) );
            }
            var handleFunction = async message => {
                var [ type, subId, event ] = JSON.parse( message.data );
                if ( !event || event === true ) return;
                var recipient = event.pubkey;
                var content = await super_nostr.alt_decrypt( privkey, recipient, event.content );
                var json = JSON.parse( content );
                item_listened_for = json.msg_value;
            }
            var connection_id = await super_nostr.newPermanentConnection( relay, listenFunction, handleFunction );
            chain_client.main_connection = connection_id;

            //send command
            var msg = JSON.stringify({msg_type: command, msg_value: params});
            var emsg = await super_nostr.alt_encrypt( privkey, miner, msg );
            var event = await super_nostr.prepEvent( privkey, emsg, 4, [ [ "p", miner ] ] );
            var socket = super_nostr.sockets[ chain_client.main_connection ].socket;
            var loop = async () => {
                if ( socket.readyState === 1 ) return;
                await chain_client.waitSomeTime( 10 );
                return loop();
            }
            await loop();
            super_nostr.sendEvent( event, socket );

            //listen for reply
            var loop = async () => {
                await chain_client.waitSomeTime( 10 );
                if ( !item_listened_for ) return loop();
            }
            await loop();

            //delete connection
            try {
                var loop = async () => {
                    if ( !super_nostr.sockets.hasOwnProperty( connection_id ) ) return;
                    super_nostr.sockets[ connection_id ].socket.close();
                    delete super_nostr.sockets[ connection_id ];
                    var rand_interval = Math.floor( Math.random() * 1000 ) + 1000;
                    await chain_client.waitSomeTime( rand_interval );
                    loop();
                }
                loop();
            } catch ( e ) {}

            //return reply
            return item_listened_for;
        }
        return commander;
    },
    commander: async ( network, command, params ) => {
        //this codeblock is for the use of testnet_generator
        if ( typeof network === "object" ) {
            var commander = chain_client.createCommander( network );
            var reply = await commander( command, params );
            chain_client.most_recent_fulfilled_command = [ command, reply ];
            return reply;
        }
        //this codeblock is for the use of electrum servers
        if ( typeof network === "string" && network.startsWith( "ws" ) ) {
            return new Promise( async resolve => {
                var socket = new WebSocket( network );
                var loop = async () => {
                    if ( socket.readyState === 1 ) return;
                    await chain_client.waitSomeTime( 1 );
                    return loop();
                }
                await loop();
                var formatted_command = {
                    id: "setup_id",
                    method: "server.version",
                    params: [ "", "1.6" ],
                }
                socket.send( JSON.stringify( formatted_command ) );
                var command_id = chain_client.getPrivkey().substring( 0, 16 );
                if ( command === "blockheight" && !params ) {
                    var formatted_command = {
                        "id": command_id,
                        "method": "blockchain.headers.subscribe",
                        "params": [],
                    }
                    var handleFunction = async message => {
                        var json = JSON.parse( message.data );
                        if ( json.id !== command_id ) return;
                        socket.close();
                        resolve( json.result.height );
                    }
                    socket.addEventListener( 'message', handleFunction );
                    socket.send( JSON.stringify( formatted_command ) );
                    return;
                }
                if ( command === "blockheight" && params ) {
                    var txid = params;
                    var txhex = null;
                    var confirmations = null;
                    var height = null;
                    var formatted_command = {
                        id: command_id,
                        method: "blockchain.transaction.get",
                        params: [ txid, true ],
                    }
                    var handleFunction = async message => {
                        var json = JSON.parse( message.data );
                        if ( json.id === command_id ) {
                            if ( !json.result.confirmations ) {
                                resolve( 'unconfirmed' );
                                return;
                            }
                            txhex = json.result.hex;
                            confirmations = json.result.confirmations;
                            var alt_command_id = chain_client.getPrivkey().substring( 0, 16 );
                            var formatted_command = {
                                id: alt_command_id,
                                method: "blockchain.headers.subscribe",
                                params: [],
                            }
                            socket.send( JSON.stringify( formatted_command ) );
                        } else if ( json.id !== "setup_id" ) {
                            socket.close();
                            height = json.result.height;
                        }
                    }
                    socket.addEventListener( 'message', handleFunction );
                    socket.send( JSON.stringify( formatted_command ) );
                    var loop = async () => {
                        if ( height ) {
                            resolve( height + 1 - confirmations );
                            return;
                        }
                        await chain_client.waitSomeTime( 10 );
                        return loop();
                    }
                    await loop();
                    return;
                }
                if ( command === "rawtx" ) {
                    var txid = params;
                    var formatted_command = {
                        id: command_id,
                        method: "blockchain.transaction.get",
                        params: [ txid ],
                    }
                    var handleFunction = async message => {
                        var json = JSON.parse( message.data );
                        if ( json.id !== command_id ) return;
                        socket.close();
                        resolve( json.result );
                    }
                    socket.addEventListener( 'message', handleFunction );
                    socket.send( JSON.stringify( formatted_command ) );
                    return;
                }
                if ( command === "broadcast" ) {
                    var package = params.split( "," );
                    var formatted_command = {
                        id: command_id,
                        method: "blockchain.transaction.broadcast_package",
                        params: [ package ],
                    }
                    var handleFunction = async message => {
                        var json = JSON.parse( message.data );
                        if ( json.id === command_id ) return;
                        if ( !json.result ) {
                            resolve( json.error.message );
                            return;
                        }
                        //TODO: consider whether to rework this; I suspect it will return whichever txid comes first when sorted alphabetically, whereas chain_client always returns the txid of the parent. But I think all of my current software just checks if the result is a 64 byte hex string as an indicator of success, so maybe that's fine
                        resolve( Object.keys( json.result.txs )[ 0 ] );
                    }
                    socket.addEventListener( 'message', handleFunction );
                    socket.send( JSON.stringify( formatted_command ) );
                    return;
                }
                if ( command === "utxos" ) {
                    var address = params;
                    var scripthex = tapscript.Script.encode( tapscript.Address.toScriptPubKey( address ) ).hex.substring( 2 );
                    var scripthash = await chain_client.sha256( chain_client.hexToBytes( scripthex ) );
                    var revhash = chain_client.reverseHexString( scripthash );
                    var formatted_command = {
                        id: command_id,
                        method: "blockchain.scripthash.get_history",
                        params: [ revhash ],
                    }
                    var txids_and_heights = {}
                    var utxos = [];
                    var last_txid = null;
                    var handleFunction = async message => {
                        var json = JSON.parse( message.data );
                        if ( json.id === command_id ) {
                            if ( !json.result.length ) {
                                resolve( [] );
                                return;
                            }
                            var i; for ( i=0; i<json.result.length; i++ ) {
                                var txid = json.result[ i ].tx_hash;
                                txids_and_heights[ txid ] = json.result[ i ].height;
                                if ( i === json.result.length - 1 ) last_txid = txid;
                                var alt_command_id = chain_client.getPrivkey().substring( 0, 16 );
                                var formatted_command = {
                                    id: alt_command_id,
                                    method: "blockchain.transaction.get",
                                    params: [ txid, true ],
                                }
                                socket.send( JSON.stringify( formatted_command ) );
                            }
                        } else if ( json.id !== "setup_id" ) {
                            var txhex = json.result.hex;
                            var block_hash = json.result.blockhash;
                            var block_time = json.result.blocktime;
                            var txid = tapscript.Tx.util.getTxid( txhex );
                            var outputs = tapscript.Tx.decode( txhex ).vout;
                            outputs.forEach( ( vout, index ) => {
                                if ( vout.scriptPubKey !== scripthex ) return;
                                var status = {
                                    confirmed: false,
                                }
                                if ( txids_and_heights[ txid ] > 0 ) status = {
                                    confirmed: true,
                                    block_height: txids_and_heights[ txid ],
                                    block_hash,
                                    block_time,
                                }
                                utxos.push({
                                    txid,
                                    vout: index,
                                    value: Number( vout.value ),
                                    status,
                                });
                            });
                            if ( txid === last_txid ) {
                                socket.close();
                                resolve( utxos );
                            }
                        }
                    }
                    socket.addEventListener( 'message', handleFunction );
                    console.log( 'sending' );
                    socket.send( JSON.stringify( formatted_command ) );
                    console.log( 'sent' );
                    return;
                }
                if ( command === "spend_txs" ) {
                    var address = params;
                    var scripthex = tapscript.Script.encode( tapscript.Address.toScriptPubKey( address ) ).hex.substring( 2 );
                    var scripthash = await chain_client.sha256( chain_client.hexToBytes( scripthex ) );
                    var revhash = chain_client.reverseHexString( scripthash );
                    var formatted_command = {
                        id: command_id,
                        method: "blockchain.scripthash.get_history",
                        params: [ revhash ],
                    }
                    var outpoints_and_inputs = {}
                    var spend_txs = [];
                    var last_a_txid = null;
                    var last_b_txid = null;
                    var handleFunction = async message => {
                        var json = JSON.parse( message.data );
                        if ( json.id === command_id ) {
                            if ( !json.result.length ) {
                                resolve( [] );
                                return;
                            }
                            var i; for ( i=0; i<json.result.length; i++ ) {
                                var txid = json.result[ i ].tx_hash;
                                if ( i === json.result.length - 1 ) last_a_txid = txid;
                                var a_command_id = chain_client.getPrivkey().substring( 0, 16 );
                                var formatted_command = {
                                    id: "a_" + a_command_id,
                                    method: "blockchain.transaction.get",
                                    params: [ txid ],
                                }
                                socket.send( JSON.stringify( formatted_command ) );
                            }
                        } else if ( json.id.startsWith( "a_" ) ) {
                            //if we are in this section then we know this is a tx in our the history of the address we are investigating; I call it an a_tx. We must now find out if this a_tx spent a utxo locked to our address. To do that we get each input utxo in the a_tx and query for the transaction that created each one; I call that transaction a b_tx. We also remind ourselves, via the outpoints_and_inputs object, which specific output of the b_tx we are interested in; if that output of the b_tx is locked to our address, then we know our a_tx actually spent it, and we even know which input of our a_tx spent it (I call that j below).
                            var txhex = json.result;
                            var txid = tapscript.Tx.util.getTxid( txhex );
                            var tx = tapscript.Tx.decode( txhex );
                            var j; for ( j=0; j<tx.vin.length; j++ ) {
                                var vin = tx.vin[ j ];
                                //the string vin.txid below refers to a b_tx which created an output spent by the a_tx; the output is specified as the key in an object created below, and we must check that b_tx to see if the vout referred to locked some money to the address we are investigating
                                //in the string `${txid}_${j}`, the txid refers to the a_tx, and the j refers to the input of that a_tx which spent the outpoint in question
                                if ( vin.txid === "0".repeat( 64 ) ) continue;
                                if ( !outpoints_and_inputs.hasOwnProperty( vin.txid ) ) outpoints_and_inputs[ vin.txid ] = {};
                                outpoints_and_inputs[ vin.txid ][ vin.vout ] = `${txid}_${j}`;

                                //get the prev tx to see if it locked money to our utxo was spent in it
                                var b_command_id = chain_client.getPrivkey().substring( 0, 16 );
                                var formatted_command = {
                                    id: "b_" + b_command_id,
                                    method: "blockchain.transaction.get",
                                    params: [ vin.txid ],
                                }
                                socket.send( JSON.stringify( formatted_command ) );

                                //if we are investigating the input of the last a_tx, set the last b_tx
                                if ( txid === last_a_txid && j === tx.vin.length - 1 ) last_b_txid = vin.txid;
                            }
                        } else if ( json.id.startsWith( "b_" ) ) {
                            //if we are in this section then we know this is a b_tx, that is, a tx that supposedly locked money to our address. We must check if the outputs references in the outpoints_and_inputs object actually locked money to our address; if they did, we can list add the string `${txid}_${j}` to spend_txs
                            var txhex = json.result;
                            var txid = tapscript.Tx.util.getTxid( txhex );
                            var outputs = tapscript.Tx.decode( txhex ).vout;
                            if ( !outpoints_and_inputs.hasOwnProperty( txid ) ) console.log( 'i was asked to check', txid, 'which does not exist in the object:', outpoints_and_inputs );
                            var outputs_we_are_interested_in = Object.keys( outpoints_and_inputs[ txid ] ).map( Number );
                            outputs.forEach( ( vout, index ) => {
                                if ( !outputs_we_are_interested_in.includes( index ) ) return;
                                if ( vout.scriptPubKey !== scripthex ) return;
                                spend_txs.push( outpoints_and_inputs[ txid ][ index ] );
                            });
                            if ( txid === last_b_txid ) {
                                socket.close();
                                resolve( spend_txs );
                            }
                        }
                    }
                    socket.addEventListener( 'message', handleFunction );
                    socket.send( JSON.stringify( formatted_command ) );
                    return;
                }
                resolve( "unsupported command" );
            });
        }
    },
}

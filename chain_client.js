//dependencies:
// https://supertestnet.github.io/bankify/super_nostr.js
// https://bundle.run/noble-secp256k1@1.2.14
var chain_client = {
    getPrivkey: () => window.crypto.getRandomValues( new Uint8Array( 32 ) ).toHex(),
    getPubkey: privkey => nobleSecp256k1.getPublicKey( privkey, true ).substring( 2 ),
    waitSomeTime: num => new Promise( resolve => setTimeout( resolve, num ) ),
    textToHex: text => {
        var encoded = new TextEncoder().encode( text );
        return Array.from( encoded )
            .map( x => x.toString( 16 ).padStart( 2, "0" ) )
            .join( "" );
    },
    createNetwork: relays => {
        var privkey = chain_client.getPrivkey();
        var pubkey = chain_client.getPubkey( privkey );
        var hex_relays = chain_client.textToHex( JSON.stringify( relays ) );
        var iframe = document.createElement( "iframe" );
        iframe.src = `https://supertestnet.github.io/testnet_generator/#privkey=${privkey}#relays=${hex_relays}`;
        iframe.style.display = "none";
        iframe.className = `chain_client_network_${privkey}`;
        document.body.append( iframe );
        return [ privkey, `${pubkey},${relays[ 0 ]}` ];
    },
    loadNetwork: ( privkey, network_string ) => {
        var [ pubkey, relay ] = network_string.split( "," );
        var relays = [ relay ];
        var hex_relays = chain_client.textToHex( JSON.stringify( relays ) );
        var iframe = document.createElement( "iframe" );
        iframe.src = `https://supertestnet.github.io/testnet_generator/#privkey=${privkey}#relays=${hex_relays}`;
        iframe.style.display = "none";
        iframe.className = `chain_client_network_${privkey}`;
        document.body.append( iframe );
        return [ privkey, network_string ];
    },
    commander: async ( network, command, params ) => {
        if ( typeof network === "object" ) {
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

                //send command
                var msg = JSON.stringify({msg_type: command, msg_value: params});
                var emsg = await super_nostr.alt_encrypt( privkey, miner, msg );
                var event = await super_nostr.prepEvent( privkey, emsg, 4, [ [ "p", miner ] ] );
                super_nostr.sendEvent( event, relay );

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
        }
        var reply = await commander( command, params );
        return reply;
    },
}

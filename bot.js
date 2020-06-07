const {Client} = require('discord.js');
// const { Client } = require('discord.js');
// const client = new Client({ ws: { intents: ['GUILDS', 'GUILD_MESSAGES'] } });
const Keyv = require('keyv');
const config = require('./params.json');
const fs = require('fs')
const regexDiscord = "(?:https?:\\/\\/)?(?:www\\.)?discord(?:\\.gg|(?:app)?\\.com\\/invite)\\/(\\S+)"
let globalPrefix = '!';
let connectionURL = "";
let token = "";
let keyv;
let channelList = [];
const client = new Client({ws: {intents: ['GUILDS', 'GUILD_MESSAGES']}});


fs.readFile('./params.json', 'utf8', async (err, jsonString) => {
    if (err) {
        console.log("Error reading file from disk:", err);
        return
    }
    try {
        const config = JSON.parse(jsonString)
        globalPrefix = config.prefix;
        connectionURL = config.connectionUrl;
        token = config.token;
        client.login(token);
        keyv = new Keyv(connectionURL);
        if (await keyv.get('channels') == null) {
            channelList = [];
        } else {

            channelList = await keyv.get('channels')
        }
        keyv.on('error', err => console.error('Keyv connection error:', err));
    } catch (err) {
        console.error('Error parsing JSON string:', err)

    }
});


client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

function getFirstGroup(regexp, str) {
    return Array.from(str.matchAll(regexp), m => m[1]);
}

async function getChanneldata(channelid) {
    let channeldata = await keyv.get(channelid);
    if (channeldata === undefined) {
        channeldata = {version: 1, roleList: [], requiresInvite: false}

    } else if (channeldata.version === undefined || channeldata.version < 1) {
        channeldata = {version: 1, roleList: channeldata, requiresInvite: false}
    }

    return channeldata;
}

async function getUserdata(userId) {
    let userdata = await keyv.get(userId);
    if (userdata === undefined || userdata.version === undefined || userdata.version < 1) {
        userdata = {version: 1, cooldownList: [], linkedServer: '-1'}
        let cooldownList;
        cooldownList = [];
        for (var k in channelList) {
            cooldownList.push([channelList[k], 0]);
        }
        userdata.cooldownList = cooldownList;
    }
    return userdata;
}

async function getServerOptions(guildId) {
    let serverOptions = await keyv.get(guildId);
    if (serverOptions === undefined) {
        serverOptions = {version: 1, owner: -1, allowOthers: true, grantedPeople: [], lastTimePostedInChannels: []};

        let cooldownList;
        cooldownList = [];
        for (var k in channelList) {
            cooldownList.push([channelList[k], 0]);
        }
        serverOptions.lastTimePostedInChannels = cooldownList;


    }
    if (serverOptions.lastTimePostedInChannels.length !== channelList.length) {
        for (var k in channelList) {
            let contains = false;
            for (var i in serverOptions.lastTimePostedInChannels)
                if (channelList[k] === serverOptions.lastTimePostedInChannels[i][0]) {
                    contains = true;
                }
            if (!contains) {
                serverOptions.lastTimePostedInChannels.push([channelList[k], 0]);
            }
        }
    }
    return serverOptions
}

async function checkModeratorStatus(member) {
    //region moderatorcheck
    let moderatorRoles;
    if (await keyv.get('moderatorRoles') == null) {
        moderatorRoles = [];
    } else {

        moderatorRoles = await keyv.get('moderatorRoles')
    }
    let hasModeratorRole = false;
    for (var k in moderatorRoles) {
        if (member._roles.includes(moderatorRoles[k])) {
            hasModeratorRole = true;
        }
    }
    //endregion
    return hasModeratorRole || member.hasPermission('ADMINISTRATOR');
}

async function checkCooldown(invite, message) {

    let serverOptions = await getServerOptions(invite.guild.id);
    let isAllowedToPost = false;
    if (serverOptions.allowOthers) {
        isAllowedToPost = true;
    } else {
        if (serverOptions.owner === message.member.id) {
            isAllowedToPost = true
        } else {
            for (let i in serverOptions.allowOthers) {
                isAllowedToPost = (serverOptions.allowOthers[i] === message.member.id) || isAllowedToPost;
            }
        }
    }

    if (!isAllowedToPost) {
        message.reply("The owner of the discordserver linked in your post has disabled random people posting without his/her consent. Contact the owner to be added to the list of people being able to post by using `!addperson`, or by disabling this option by using `!togglepermission`").then(msg => {
            msg.delete({timeout: 60000})
        });
        return;
    }
    let list = serverOptions.grantedPeople.concat(message.member.id)
    var guild = client.guilds.resolve(message.member);
    let minimumTime = Number.MAX_SAFE_INTEGER;

    for (let x in list) {
        let idUser = list[x]
        for (var channel in serverOptions.lastTimePostedInChannels) {
            if (serverOptions.lastTimePostedInChannels[channel][0] === message.channel.id) {

                let roleList = (await keyv.get(message.channel.id)).roleList;
                let roleMatch = false;
                for (var roleListKey in roleList) {
                    await guild.members.fetch(idUser).then(member => {
                            if (member._roles.includes(roleList[roleListKey][0]) || roleList[roleListKey][0] === "default") {
                                //console.log(roleListKey + " " + cooldownListKey + " " + minimumTime + " " + roleList[roleListKey][1]);
                                if (Number(minimumTime) > Number(roleList[roleListKey][1])) {
                                    minimumTime = roleList[roleListKey][1];
                                    roleMatch = true;
                                }
                            }
                        }
                    ).catch(console.error);

                }

            }
        }
    }
    if (Number(serverOptions.lastTimePostedInChannels[channel][1]) + parseInt(minimumTime) > parseInt(new Date().getTime())) {
        message.delete();
        let time = Math.floor((Number(serverOptions.lastTimePostedInChannels[channel][1]) + parseInt(minimumTime) - parseInt(new Date().getTime())) / 60000);
        message.reply('The next time you can post is in ' + ((time == 0) ? (Math.floor((Number(serverOptions.lastTimePostedInChannels[channel][1])
            + parseInt(minimumTime) - parseInt(new Date().getTime())) / 1000) + 1) + ' seconds' : Math.floor(time / 60)
            + ' hours, ' + time % 60 + ' minutes.') +'\nThis cooldown is shared between everyone advertising that server, if you want to prevent other people from advertising your server, claim ownership of your server using `!claimserver`').then(msg => {
            msg.delete({timeout: 60000})
        });

    } else {
        serverOptions.lastTimePostedInChannels[channel][1] = parseInt(new Date().getTime())
    }


    await keyv.set(invite.guild.id, serverOptions)

}

client.on('guildCreate', async guild => {

        let serverOptions = await getServerOptions(guild.id);
        serverOptions.owner = guild.ownerID;
        serverOptions.grantedPeople.push(guild.ownerID);
        await keyv.set(guild.id, serverOptions)
        if (client.guilds.cache.size > 1) {
            guild.leave();
        }
    }
)

client.on('message', async message => {
    if (message.content.startsWith(globalPrefix)) {
        let args = message.content.split(' ');
        if (args[0].toLowerCase() === (globalPrefix + 'setslowmode')) {
            if (args.length !== 4) {
                message.reply('Please use proper syntax: `' + globalPrefix + 'addslowmode duration(ms) @Role #Channel`');
                return;
            }
            if (args[1] <= 0) {
                message.reply('Don\'t include negative numbers.')
                return;
            }

            if (await checkModeratorStatus(message.member)) {
                const role = message.mentions.roles.first();
                const channel = message.mentions.channels.first();
                const everyone = message.mentions.everyone;
                if ((!role && !everyone) || !channel) {
                    message.reply('Please include a channel and/or Role: `' + globalPrefix + 'addslowmode duration(ms) @Role #Channel`');
                    return;
                }
                let channeldata = await getChanneldata(channel.id);

                let update = false;
                for (var k in channeldata.roleList) {
                    if (channeldata.roleList[k][0] == (role ? role.id : 'default')) {
                        channeldata.roleList[k][1] = parseInt(args[1]);
                        update = true;
                    }
                }
                if (!update) {
                    channeldata.roleList.push([(role ? role.id : 'default'), args[1]])
                }
                if (!channelList.includes(channel.id)) {
                    channelList.push(channel.id);
                    keyv.set('channels', channelList);
                }
                await keyv.set(channel.id, channeldata);
                message.reply('Slowmode set for ' + (role ? role.id : '@ everyone') + ' in ' + channel + '. Duration: ' + args[1]);

            } else {
                message.reply('Make sure you have administrator permissions to use this command.');
            }
            return;

        }
        if (args[0].toLowerCase() === (globalPrefix + 'removemoderatorroles')) {
            if (message.member.hasPermission('ADMINISTRATOR')) {
                await keyv.set('moderatorRoles');
                message.reply('All moderatorRoles deleted.')
            } else {
                message.reply('Make sure you have administrator permissions to use this command.');
            }
            return;

        }
        if (args[0].toLowerCase() === (globalPrefix + 'addmoderatorrole')) {
            if (message.member.hasPermission('ADMINISTRATOR')) {
                const role = message.mentions.roles.first();
                if (role) {
                    let moderatorRoles;
                    if (await keyv.get('moderatorRoles') == null) {
                        moderatorRoles = [];
                    } else {

                        moderatorRoles = await keyv.get('moderatorRoles')
                    }
                    if (moderatorRoles.includes(role.id)) {
                        message.reply('Role was already added');
                    } else {
                        moderatorRoles.push(role.id);
                        await keyv.set('moderatorRoles', moderatorRoles);
                        message.reply('Role added');
                    }
                } else {
                    message.reply('Please include a role.')
                }
            } else {
                message.reply('Make sure you have administrator permissions to use this command.');
            }
            return;
        }
        if (args[0].toLowerCase() === (globalPrefix + 'clearmember')) {
            //region moderatorcheck
            let moderatorRoles;
            if (await keyv.get('moderatorRoles') == null) {
                moderatorRoles = [];
            } else {

                moderatorRoles = await keyv.get('moderatorRoles')
            }
            let hasModeratorRole = false;
            for (var k in moderatorRoles) {
                if (message.member._roles.includes(moderatorRoles[k])) {
                    hasModeratorRole = true;
                }
            }
            //endregion
            if (message.member.hasPermission('ADMINISTRATOR') || hasModeratorRole) {
                const user = message.mentions.users.first();
                if (user) {
                    await keyv.set(user.id);
                    message.reply('User cooldownList cleared')
                } else {
                    message.reply('Please mention a user')

                }
            } else {
                message.reply('Make sure you have administrator permissions to use this command.');

            }
            return;
        }
        if (args[0].toLowerCase() === (globalPrefix + 'help')) {
            message.delete();
            message.channel.send('`!addModeratorRole <@Role> ` Adds a role to the moderator list, this role will bypass the cooldowns, and can edit the cooldowns.\n'
                + '`!removeModeratorRoles` Removes all moderator role.\n'
                + '`!setSlowMode <time> <@Role> <#Channel>` Adds the slowmode, time should be in milliseconds.\n'
                + '`!clearMember <@User` Removes all cooldowns from a person.\n'
                + '`!claimServer` Gives the invite link for the bot, this way you can claim ownership of the server you\'re advertising.\n'
                + '`!unlinkself` This will unlink you from a server if you\'re currently linked to one.\n'
                + '`!addPerson <serverId> <@User1> [@User2+...]` Adds one or more people to the list of being able to advertise the server, make sure you have disabled other people from advertising the server by using `!togglepermission`.\n'
                + '`!debug <channelId|UserId|ServerId>` Shows info, need moderator role to use.\n'
                + '`!removeperson <serverId> <@User1> [@User2+...]` Removes one or more people from the list of being able to advertise the server, make sure you have disabled other people from advertising the server by using `!togglepermission`.\n'
                + '`!requireinvite <#Channel>` Toggles it so the channel requires (or doesn\'t require one anymore) a discord invite in order to not be deleted.\n'
                + '`!togglepermission <serverId>` Toggles if only added people are able to advertise the server or not.\n'
                + 'Info on obtaining id\'s can be found using this link: <https://support.discordapp.com/hc/en-us/articles/360000291932-How-to-Properly-Report-Issues-to-Trust-Safety>'
            );
        }
        if (args[0].toLowerCase() === (globalPrefix + 'claimserver')) {
            message.delete();
            message.channel.send('Add the bot to your server by inviting it trough this link, it will just check the server owner, then leave again.\n https://discord.com/api/oauth2/authorize?client_id=433772822133997568&permissions=0&scope=bot').then(msg => {
                msg.delete({timeout: 60000})
            });
            return;
        }
        if (args[0].toLowerCase() === (globalPrefix + 'unlinkself')) {
            let userdata = await getUserdata(message.member.id);
            let linkedserver = userdata.linkedServer;
            if (userdata.linkedServer !== '-1') {
                let serverOptions = await getServerOptions(userdata.linkedServer);
                userdata.linkedServer = -1;
                serverOptions.grantedPeople.splice(serverOptions.grantedPeople.indexOf(message.member.id), 1);
                await keyv.set(linkedserver, serverOptions);

            }
            await keyv.set(message.member.id, userdata);
            message.reply('Unlinked yourself from the server.').then(msg => {
                msg.delete({timeout: 60000})
            });
            return;
        }
        if (args[0].toLowerCase() === (globalPrefix + 'addperson')) {
            if (args.length < 3) {
                message.reply('Please use proper syntax: `' + globalPrefix + 'addPerson <serverId> <@User1> [@User2+...]`');
                return;
            }
            let serverOptions = await keyv.get(args[1]);
            if (serverOptions === undefined) {
                message.reply('Server not found, please make sure you\'ve posted the correct serverId. If the server hasn\'t been advertised before, make sure to claim ownership of the server first, using `!claimserver`.')
                return;

            }
            if (serverOptions.owner === -1 && !(await checkModeratorStatus(message.member))) {
                message.reply('No owner has been set for this server, claim the ownership of the server following the instruction from `!claimserver`').then(msg => {
                    msg.delete({timeout: 60000})
                });

            } else if (message.member.id === serverOptions.owner || (await checkModeratorStatus(message.member))) {
                for (const [key, user] of message.mentions.users) {
                    if (serverOptions.grantedPeople.indexOf(user.id) === -1) {
                        let userdata = await getUserdata(user.id);
                        if (userdata.linkedServer !== '-1') {
                            message.channel.send('\`' + user.username + '\` is already linked to a server.').then(msg => {
                                msg.delete({timeout: 20000})
                            });
                        } else {
                            userdata.linkedServer = args[1];
                            serverOptions.grantedPeople.push(user.id);
                            message.channel.send('\`' + user.username + '\` added.').then(msg => {
                                msg.delete({timeout: 20000})
                            });
                        }
                        await keyv.set(user.id, userdata);
                    } else {
                        message.channel.send('\`' + user.username + '\` is already able to advertise this server.').then(msg => {
                            msg.delete({timeout: 20000})
                        });
                    }
                }

                // message.mentions.users.forEach(user => serverOptions.grantedPeople.indexOf(user.id) === -1 ? serverOptions.grantedPeople.push(user.id) : 'a');
            } else {
                message.reply('Only the owner of the server can use that command, if the owner of the server has changed, follow the steps in `!claimserver` to update it.').then(msg => {
                    msg.delete({timeout: 60000})
                });
            }

            await keyv.set(args[1], serverOptions);

            message.delete();
            return;
        }
        if (args[0].toLowerCase() === (globalPrefix + 'debug')) {
            if (checkModeratorStatus(message.member)) {
                let data = await keyv.get(args[1]);
                console.log(data);
                await message.channel.send(JSON.stringify(data));
            }
            return;
        }
        if (args[0].toLowerCase() === (globalPrefix + 'removeperson')) {
            if (args.length < 3) {
                message.reply('Please use proper syntax: `' + globalPrefix + 'removePerson <serverId> <@User1> [@User2+...]`');
                return;
            }
            let serverOptions = await keyv.get(args[1]);
            if (serverOptions === undefined) {
                message.reply('Server not found, please make sure you\'ve posted the correct serverId. If the server hasn\'t been advertised before, make sure to claim ownership of the server first, using `!claimserver`.')
                return;

            }
            if (serverOptions.owner === -1 && !(await checkModeratorStatus(message.member))) {
                message.reply('No owner has been set for this server, claim the ownership of the server following the instruction from `!claimserver`').then(msg => {
                    msg.delete({timeout: 60000})
                });

            } else if (message.member.id === serverOptions.owner || (await checkModeratorStatus(message.member))) {
                for (const [key, user] of message.mentions.users) {
                    if (serverOptions.grantedPeople.indexOf(user.id) !== -1) {
                        let userdata = await getUserdata(user.id);
                        if (userdata.linkedServer !== args[1]) {
                            message.channel.send('\`' + user.username + '\` is linked to a different server.').then(msg => {
                                msg.delete({timeout: 20000})
                            });
                        } else {
                            userdata.linkedServer = '-1';
                            serverOptions.grantedPeople.splice(serverOptions.grantedPeople.indexOf(user.id), 1);
                            message.channel.send('\`' + user.username + '\` removed.').then(msg => {
                                msg.delete({timeout: 20000})
                            });
                        }
                        await keyv.set(user.id, userdata);
                    } else {
                        message.channel.send('\`' + user.username + '\` is not found in the list.').then(msg => {
                            msg.delete({timeout: 20000})
                        });
                    }
                }

                // message.mentions.users.forEach(user => serverOptions.grantedPeople.indexOf(user.id) === -1 ? serverOptions.grantedPeople.push(user.id) : 'a');
            } else {
                message.reply('Only the owner of the server can use that command, if the owner of the server has changed, follow the steps in `!claimserver` to update it.').then(msg => {
                    msg.delete({timeout: 60000})
                });
            }

            await keyv.set(args[1], serverOptions);

            message.delete();
            return;
        }
        if (args[0].toLowerCase() === (globalPrefix + 'requireinvite')) {

            let channeldata = await getChanneldata(args[1]);
            channeldata.requiresInvite = !channeldata.requiresInvite;
            message.reply(channeldata.requiresInvite ? 'This channel now requires invites' : 'This channel no longer requires invites.').then(msg => {
                msg.delete({timeout: 60000})
            });
            await keyv.set(message.channel.id, channeldata)
            return;
        }
        if (args[0].toLowerCase() === (globalPrefix + 'togglepermission')) {

            let serverOptions = await keyv.get(args[1]);
            if (serverOptions === undefined) {
                message.reply('Server not found, please make sure you\'ve posted the correct serverId. If the server hasn\'t been advertised before, make sure to claim ownership of the server first, using `!claimserver`.').then(msg => {
                    msg.delete({timeout: 60000})
                });
                return;

            }
            if (serverOptions.owner === -1 && !(await checkModeratorStatus(message.member))) {
                message.reply('No owner has been set for this server, claim the ownership of the server following the instruction from `!claimserver`').then(msg => {
                    msg.delete({timeout: 60000})
                });

            } else if (message.member.id === serverOptions.owner) {
                serverOptions.allowOthers = !serverOptions.allowOthers;
                message.reply(serverOptions.allowOthers ? 'Everyone is now allowed to advertise this server' : 'Only people added can now advertise this server, you can add more people by using `!addPerson`').then(msg => {
                    msg.delete({timeout: 60000})
                });

            } else {
                message.reply('Only the owner of the server can use that command, if the owner of the server has changed, follow the steps in `!claimserver` to update it.').then(msg => {
                    msg.delete({timeout: 60000})
                });
            }

            await keyv.set(args[1], serverOptions);

            message.delete();
            return;
        }


    }
    // if (!('/'+globalPrefix + 'allowOtherPeople/')i.test) {
    //     message.delete();
    //     message.channel.send('Add the bot to your server by inviting it trough this link, it will just check the server owner, then leave again.\n https://discord.com/api/oauth2/authorize?client_id=482971210251108352&permissions=0&scope=bot').then(msg => {
    //         msg.delete({timeout: 60000})
    //     });
    //     return;
    // }
    //todo: channels without need toggle between needing server link or default
    if (channelList.includes(message.channel.id)) {
        if (await checkModeratorStatus(message.member)) {
            return;
        }
        if ((await getChanneldata(message.channel.id)).requiresInvite) {
            var match = getFirstGroup(regexDiscord, message.content);
            if (match.length != 1) {
                message.delete();
                message.reply("Please make sure your post contains one invite link.").then(msg => {
                    msg.delete({timeout: 60000})
                });
                return;
            }
            client.fetchInvite(match[0])
                .then(invite => checkCooldown(invite, message))
                .catch(console.error);
            return;
        } else {
//todo same as above
            userdata = await getUserdata(message.member.id);
            // if (await keyv.get(message.member.id) == null) {
            //     cooldownList = [];
            //     for (var k in channelList) {
            //         cooldownList.push([channelList[k], 0]);
            //     }
            // } else {
            //     cooldownList = await keyv.get(message.member.id);
            //     if (cooldownList.length !== channelList.length) {
            //         for (var k in channelList) {
            //             let contains = false;
            //             for (var i in cooldownList)
            //                 if (channelList[k] === cooldownList[i][0]) {
            //                     contains = true;
            //                 }
            //             if (!contains) {
            //                 cooldownList.push([channelList[k], 0]);
            //             }
            //         }
            //     }
            //     await keyv.set(message.member.id, cooldownList);
            // }
            for (var cooldownListKey in userdata.cooldownList) {

                if (userdata.cooldownList[cooldownListKey][0] == message.channel.id) {
                    if (Number(userdata.cooldownList[cooldownListKey][1]) < Number(new Date().getTime())) {
                        let roleList = (await keyv.get(message.channel.id)).roleList;
                        let minimumTime = Number.MAX_SAFE_INTEGER;
                        let roleMatch = false;
                        for (var roleListKey in roleList) {
                            if (message.member._roles.includes(roleList[roleListKey][0]) || roleList[roleListKey][0] === "default") {
                                if (Number(minimumTime) > Number(roleList[roleListKey][1])) {
                                    minimumTime = roleList[roleListKey][1];
                                    roleMatch = true;
                                }
                            }
                        }
                        if (roleMatch) {
                            userdata.cooldownList[cooldownListKey][1] = parseInt(minimumTime) + parseInt(new Date().getTime());
                            await keyv.set(message.member.id, userdata);
                        }
                    } else {
                        message.delete();
                        let time = Math.floor((userdata.cooldownList[cooldownListKey][1] - new Date().getTime()) / 60000);
                        message.reply('The next time you can post is in ' + ((time == 0) ? (Math.floor((userdata.cooldownList[cooldownListKey][1] - new Date().getTime()) / 1000) + 1) + ' seconds' : Math.floor(time / 60) + ' hours, ' + time % 60 + ' minutes.')).then(msg => {
                            msg.delete({timeout: 60000})
                        });
                    }
                }
            }
        }


    }
});


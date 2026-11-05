"""Optional loopback forwards owned by an existing authenticated master."""
import re
import secrets
from studio_worker.compute.ssh_auth import fail, typed, slave_args, scope


class SSHTunnels:
    def __init__(self, auth):
        self.auth, self.forwards = auth, {}

    def plan(self, data):
        typed(data, ('cluster_id', 'version', 'owner', 'local_port', 'destination_host', 'destination_port'),
              ('cluster_id', 'version', 'owner', 'local_port', 'destination_host', 'destination_port'))
        if type(data['version']) is not int or data['version'] < 1 or not isinstance(data['cluster_id'], str):
            fail('invalid_auth_request')
        if not isinstance(data['owner'], str) or not re.fullmatch(r'[a-f0-9]{48}', data['owner']):
            fail('invalid_auth_owner')
        host, port, local = data['destination_host'], data['destination_port'], data['local_port']
        if (not isinstance(host, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.:-]{0,255}', host) or
                type(port) is not int or not 1 <= port <= 65535 or type(local) is not int or not 1024 <= local <= 65535):
            fail('invalid_loopback_forward')
        with self.auth.lock:
            p = self.auth._profile(data['cluster_id'])
            if p['version'] != data['version']:
                fail('saved_connection_changed')
            session = self.auth.resolve(p, include_private=True)
            if session['owner'] != data['owner']:
                fail('invalid_auth_owner')
            self._forward_source(session)
            if len([v for v in self.forwards.values() if v['status'] not in ('closed', 'lost', 'failed')]) >= 4:
                fail('tunnel_limit')
            identifier = secrets.token_hex(16)
            target = '['+host+']' if ':' in host else host
            value = {'id': identifier, 'owner': data['owner'], 'session': session,
                     'spec': '127.0.0.1:%d:%s:%d' % (local, target, port), 'status': 'review',
                     'localPort': local, 'destination': {'host': host, 'port': port}, 'request': None}
            self.forwards[identifier] = value
            return {**self.public(value), 'review': {'bind': '127.0.0.1', 'localPort': local,
                                                     'destinationHost': host, 'destinationPort': port}}

    def _get(self, data, extra=()):
        typed(data, ('tunnel_id', 'owner', *extra), ('tunnel_id', 'owner'))
        value = self.forwards.get(data['tunnel_id'])
        if not value or value['session']['owner'] != data['owner']:
            fail('tunnel_unavailable')
        return value

    def public(self, value):
        return {'tunnelId': value['id'], 'clusterId': value['session']['profile']['id'],
                'version': value['session']['profile']['version'], 'status': value['status'],
                'destinationVerification': 'not_run', 'sshAuthenticated': False}

    def for_session(self, identifier):
        return [{**self.public(value), 'review': {'bind': '127.0.0.1', 'localPort': value['localPort'],
                'destinationHost': value['destination']['host'], 'destinationPort': value['destination']['port']}}
                for value in self.forwards.values() if value['session']['id'] == identifier and value['status'] not in ('closed', 'lost', 'failed')]

    def _forward_source(self, session):
        # A live master is not permission to add routes. Original-run reviews
        # may reuse their transport but never create a new forward. Retained
        # saved-profile sessions still need a fresh current-source proof here.
        if (session.get('source', {}).get('kind') != 'saved-profile' or
                session.get('newForwardAllowed') is not True):
            fail('historical_forward_disabled')
        observed = self.auth._source(session['source'])
        if (scope(observed['profile']) != session['scope'] or
                observed['sourceReceipt'] != session['sourceReceipt']):
            fail('saved_connection_changed')

    def _control(self, value, operation):
        s = value['session']
        self.auth._expire()
        if operation == 'forward':
            self._forward_source(s)
        if s['state'] != 'verified' or not self.auth._live(s):
            fail('needs_human_auth')
        args = slave_args(s['profile'], s['socket'], operation)
        # Forward spec must precede destination argv; no user command string.
        args[-5:-5] = ['-o', 'ExitOnForwardFailure=yes', '-L', value['spec']]
        result = self.auth.run(args, timeout=5, limit=8192)
        if result.returncode or not self.auth._live(s):
            fail('owned_forward_failed')

    def start(self, data):
        with self.auth.lock:
            value = self._get(data, ('request_id',))
            request = data.get('request_id')
            if not isinstance(request, str) or not re.fullmatch(r'[A-Za-z0-9-]{1,100}', request):
                fail('invalid_auth_request')
            if value['request'] == request:
                return self.public(value)
            if value['status'] != 'review':
                fail('forward_already_started')
            value['request'] = request
            try:
                self._control(value, 'forward')
                value['status'] = 'listener_ready'
            except Exception:
                value['status'] = 'failed'
            return self.public(value)

    def status(self, data):
        with self.auth.lock:
            value = self._get(data)
            self.auth._expire()
            if value['status'] == 'listener_ready' and (value['session']['state'] != 'verified' or not self.auth._live(value['session'])):
                value['status'] = 'lost'
            return self.public(value)

    def close(self, data):
        with self.auth.lock:
            value = self._get(data)
            if value['status'] == 'listener_ready':
                try:
                    self._control(value, 'cancel')
                except Exception:
                    value['status'] = 'lost'
                    return self.public(value)
            value['status'] = 'closed'
            return self.public(value)

    def close_all(self):
        for value in list(self.forwards.values()):
            self.close({'tunnel_id': value['id'], 'owner': value['session']['owner']})

"""Durable, desktop-driven schedules. Reads never dispatch or observe a scheduler."""

import math
import threading
import time

from studio_worker.compute.managed_child import checked_target, prepare_child
from studio_worker.compute.managed_schedule_policy import (
    MAX_BUDGET, SCHEDULE_KINDS, UPSERT_KEYS, fields, fingerprint, identifier, normalize_scope, plan_snapshot,
    project_parent, project_run, schedule_plan,
)


SCHEDULE = 'managed-schedule'
ROUND = 'managed-schedule-round'
MUTATION = 'managed-schedule-mutation'
DELIVERY = 'managed-schedule-delivery'
DELEGATION = 'managed-schedule-delegation'
PLAN_IDENTITY = 'managed-schedule-identity'
TERMINAL_JOBS = ('succeeded', 'failed', 'cancelled')
ACTIVE_JOBS = ('queued', 'running')
CHILD_OBSERVATION_SECONDS = 15


class ManagedSchedules:
    def __init__(self, service, clock=time.time):
        self.service, self.store, self.clock = service, service.store, clock
        self._pump_lock = threading.Lock()
        self._dispatch_token = object()
        self._poll_token = object()
        self._cancel_token = object()
        self.explicit_parent_cancel = object()
        self._dispatching = set()

    def _read(self, source, schedule_id):
        row = self.store.get(SCHEDULE, identifier(schedule_id))
        if row['sourceId'] != source:
            raise PermissionError('This schedule belongs to a different original worker source')
        return row

    def _rows(self, source):
        return [row for row in self.store.list(SCHEDULE) if row['sourceId'] == source]

    def _public(self, row):
        internal = ('script', 'wakeText', 'parent', 'action')
        summary = {**{key: value for key, value in row.items() if key not in internal}, **plan_snapshot(row)}
        summary['delegationCount'] = self._budget(row)['count']
        if summary['status'] not in ('scheduled', 'running') or summary['count'] >= summary['maxRuns']:
            summary['nextAt'] = None
        return summary

    def _budget(self, row):
        key = fingerprint([row['sourceId'], self._task_scope(row), row['delegationId']])
        return self.store.get(DELEGATION, key) if self.store.db_exists(DELEGATION, key) else {'id': key, 'count': 0}

    def _put(self, row, *records):
        row['stateRevision'] += 1
        row['updatedAt'] = self.clock()
        self.store.put_many([(SCHEDULE, row), *records])
        return row

    def upsert(self, data):
        fields(data, UPSERT_KEYS, ('sourceId', 'scope', 'kind', 'mutationId'))
        source, kind = identifier(data['sourceId']), data['kind']
        if kind not in SCHEDULE_KINDS:
            raise ValueError('Unknown managed schedule kind')
        scope = normalize_scope(data['scope'], kind)
        key = identifier(data['key']) if kind == 'script' else identifier(data.get('key', kind))
        delegation = identifier(data.get('delegationId', scope['taskId']))
        schedule_id = fingerprint([source, scope, kind, key, delegation])
        mutation_id = fingerprint([schedule_id, identifier(data['mutationId'])])
        request_hash = fingerprint(data)
        with self.store.lock:
            old = self._read(source, schedule_id) if self.store.db_exists(SCHEDULE, schedule_id) else None
            if self.store.db_exists(MUTATION, mutation_id):
                if self.store.get(MUTATION, mutation_id)['requestSha256'] != request_hash:
                    raise ValueError('Managed schedule mutation was already used for another request')
                return self._public(old)
            expected = data.get('expectedRevision')
            if (expected is not None and (type(expected) is not int or expected < 0) or
                    (old['revision'] if old else None) != expected):
                raise ValueError('Managed schedule revision changed; read its current record before editing')
            now = self.clock()
            if old:
                self._schedule_state(old, now)
                if old['status'] not in ('scheduled', 'running'):
                    raise ValueError('This schedule preserves its completed or unconfirmed execution budget')
            plan = schedule_plan({**data, 'key': key}, old, now)
            parent, reference = project_parent(self.service, scope, old and old.get('parent'))
            if kind == 'script':
                if reference['kind'] != 'cluster' or not parent.get('submit_attempted'):
                    raise PermissionError('A temporary script requires the original submitted Slurm or LSF run')
                checked_target(self.service, parent, plan['timeoutSeconds'], plan['script']['resources'])
            if kind == 'action' and plan['action']['type'] == 'read_log' and reference['kind'] != 'cluster':
                raise ValueError('The scheduled log action requires an original Slurm or LSF run')
            record = old or {'schemaVersion': 1, 'id': schedule_id, 'sourceId': source, 'scope': scope, 'kind': kind,
                             'key': key, 'delegationId': delegation, 'parent': reference, 'createdAt': now, 'stateRevision': 0, 'revision': 0,
                             'count': 0, 'active': None, 'lastResult': None, 'stopRequestedAt': None,
                             'cancellation': None, 'nextAt': now + plan['intervalSeconds']}
            if self._budget(record)['count'] >= MAX_BUDGET:
                raise ValueError('The original delegation has used its 336 execution credits')
            identity = fingerprint([source, scope, kind, delegation, plan.get('script', {}).get('sha256'),
                                    plan.get('script', {}).get('language'), plan.get('action'), plan.get('wakeText')])
            if self.store.db_exists(PLAN_IDENTITY, identity) and self.store.get(PLAN_IDENTITY, identity)['owner'] != schedule_id:
                raise ValueError('This control action or script already belongs to a logical schedule in this delegation')
            edited = not old or any(old.get(field) != value for field, value in plan.items())
            if old and old['intervalSeconds'] != plan['intervalSeconds']:
                record['nextAt'] = now + plan['intervalSeconds']
            record.update(plan, revision=record['revision'] + int(edited))
            self._schedule_state(record, now)
            records = [(MUTATION, {'id': mutation_id, 'scheduleId': schedule_id, 'requestSha256': request_hash,
                                   'revision': record['revision']}),
                       (PLAN_IDENTITY, {'id': identity, 'owner': schedule_id})]
            if reference and reference['kind'] == 'cluster' and (kind in ('poll', 'wake_agent') or
                    kind == 'action' and plan['action']['type'] == 'status') and not parent.get('managed_schedule_parent'):
                records.append(('cluster-run', {**parent, 'managed_schedule_parent': True}))
            self._put(record, *records)
            return self._public(record)

    def _schedule_state(self, row, now):
        if row['stopRequestedAt'] is not None:
            row['status'] = 'stopped'
        elif row.get('status') == 'unknown':
            return
        elif row['active']:
            row['status'] = 'running'
        elif now >= row['expiresAt']:
            row['status'] = 'expired'
        elif row['count'] >= row['maxRuns'] or self._budget(row)['count'] >= MAX_BUDGET:
            row['status'] = 'exhausted'
        else:
            row['status'] = 'scheduled'

    def status(self, data):
        fields(data, ('sourceId', 'scheduleId'), ('sourceId', 'scheduleId'))
        with self.store.lock:
            row = self._read(identifier(data['sourceId']), data['scheduleId'])
            history = sorted((item for item in self.store.list(ROUND) if item['scheduleId'] == row['id']),
                             key=lambda item: item['occurrence'], reverse=True)[:12]
            detail = {**self._public(row), 'history': history}
            if row['kind'] == 'script':
                detail['script'] = row['script']
            return detail

    def list(self, data):
        fields(data, ('sourceId',), ('sourceId',))
        return [self._public(row) for row in self._rows(identifier(data['sourceId']))]

    def snapshot(self, data):
        fields(data, ('sourceId',), ('sourceId',))
        source = identifier(data['sourceId'])
        with self.store.lock:
            return {'sourceId': source, 'observedAt': self.clock(),
                    'runs': [project_run(row) for row in (*self.store.runs(), *self.store.list('cluster-run'))],
                    'schedules': [self._public(row) for row in self._rows(source)]}

    def _advance(self, row, now):
        interval = row['intervalSeconds']
        row['nextAt'] += (1 + max(0, math.floor((now - row['nextAt']) / interval))) * interval

    def _claim(self, row, now):
        occurrence = row['count'] + 1
        config = plan_snapshot(row)
        active = {'id': fingerprint([row['id'], occurrence]), 'occurrence': occurrence, 'dueAt': row['nextAt'],
                  'startedAt': now, 'deadlineAt': now + row['timeoutSeconds'], 'nextCheckAt': now,
                  'configSha256': fingerprint(config), 'phase': 'dispatching', 'childId': None, 'jobId': None}
        receipt = {**active, 'scheduleId': row['id'], 'sourceId': row['sourceId'], 'scope': row['scope'],
                   'plan': config, 'status': 'started'}
        row.update(count=occurrence, active=active, status='running')
        self._advance(row, now)
        budget = self._budget(row)
        self._put(row, (ROUND, receipt), (DELEGATION, {**budget, 'count': budget['count'] + 1}))
        return row

    def _active(self, owned):
        row = self._read(owned['sourceId'], owned['id'])
        active = row['active']
        if not active or active['id'] != owned['active']['id']:
            return None
        return row

    def _dispatchable(self, owned):
        row = self._active(owned)
        return bool(row and row['stopRequestedAt'] is None and
                    self.clock() < min(row['active']['deadlineAt'], row['expiresAt']))

    def _owned_child(self, run):
        binding = run.get('managed_child', {})
        row = self._read(binding['sourceId'], binding['scheduleId'])
        active = row['active'] or {}
        if (row['scope'] == binding['scope'] and active.get('childId') == run['id'] and
                active.get('occurrence') == binding['occurrence'] and active.get('configSha256') == binding['configSha256']):
            return row
        return None

    def can_submit_child(self, run, token):
        return token is self._dispatch_token and (row := self._owned_child(run)) is not None and self._dispatchable(row)

    def can_cancel_child(self, run, token):
        row = self._owned_child(run) if token is self._cancel_token else None
        return bool(row and row['active'].get('cancelAttemptedAt') is not None)

    def can_poll(self, run, token):
        if run.get('managed_child'):
            row = self._owned_child(run) if token is self._poll_token or token is self._cancel_token else None
            return bool(row and (token is self._cancel_token or row['stopRequestedAt'] is None and
                                 row['active'].get('cancelAttemptedAt') is None))
        if token is self.explicit_parent_cancel:
            return True
        return (isinstance(token, tuple) and token[0] is self._poll_token and
                token[1]['scope']['runId'] == run['id'] and self._dispatchable(token[1]))

    def _remaining(self, row):
        return max(1, math.ceil(row['active']['deadlineAt'] - self.clock()))

    def _finish(self, owned, result, *, retain_child=False, cancellation=None):
        with self.store.lock:
            row = self._active(owned)
            if row is None:
                return
            active = row['active']
            if retain_child:
                active.update(phase='unconfirmed', nextCheckAt=None)
            now = self.clock()
            result = {'occurrence': active['occurrence'], 'dueAt': active['dueAt'], 'finishedAt': now, **result}
            receipt = self.store.get(ROUND, active['id'])
            records = [(ROUND, {**receipt, **active, **result})]
            # Publish each occurrence and its delivery in the same transaction.
            if row['kind'] == 'wake_agent' and receipt['plan'].get('wakeText') and result['status'] == 'succeeded' and row['stopRequestedAt'] is None:
                event = {'id': active['id'], 'scheduleId': row['id'], 'sourceId': row['sourceId'], 'scope': row['scope'],
                         'occurrence': active['occurrence'], 'dueAt': active['dueAt'], 'observedAt': result['observedAt'],
                         'text': receipt['plan']['wakeText']}
                records.append((DELIVERY, {**event, 'state': 'pending'}))
            row['lastResult'] = {key: value for key, value in result.items() if key != 'output'}
            row['active'] = active if retain_child else None
            if cancellation is not None:
                row['cancellation'] = cancellation
            elif row['stopRequestedAt'] is not None and not active['childId']:
                row['cancellation'] = {'status': 'not_needed', 'childId': None, 'signalSent': False}
            if result['status'] == 'unknown':
                row['status'] = 'unknown'
            if row['nextAt'] <= now:
                self._advance(row, now)
            self._schedule_state(row, now)
            self._put(row, *records)

    def _observe_round(self, row, parent):
        now = self.clock()
        if parent is None:
            return {'status': 'succeeded', 'observedAt': now, 'evidence': 'timer_due'}
        clusters = self.service.clusters
        if row['kind'] == 'action' and row['action']['type'] == 'read_log':
            action = row['action']
            log = clusters.read(parent['id'], action['name'], action['offset'], limit=16384,
                                timeout=min(40, self._remaining(row)))
            if not isinstance(log.get('text'), str) or type(log.get('offset')) is not int:
                raise ValueError('Missing bounded log receipt')
            if log.get('present') is not True:
                return {'status': 'not_run', 'observedAt': self.clock(), 'reason': 'log_not_present'}
            return {'status': 'succeeded', 'observedAt': self.clock(), 'evidence': 'bounded_log',
                    'output': {'name': action['name'], 'offset': log['offset'], 'text': log['text'][:16384]}}
        if row['parent']['kind'] == 'cluster':
            clusters.poll(parent['id'], managed=(self._poll_token, row), timeout=min(40, self._remaining(row)))
            parent = clusters.raw(parent['id'])
        observation = project_run(parent)
        # Status can be a normal saved draft or a terminal receipt. For running
        # cluster jobs, require the scheduler's original job identity evidence.
        verified = bool(observation['observedAt'] and parent['status'] != 'unknown')
        status = 'succeeded' if verified or parent['status'] in ('draft', 'ready') else 'unknown'
        return {'status': status, 'observedAt': observation['observedAt'], 'evidence': 'run_state', 'run': observation}

    def _submit_child(self, row, parent):
        child = prepare_child(self.service, row, row['active'], parent)
        with self.store.lock:
            if not self._dispatchable(row):
                return self._finish(row, {'status': 'skipped', 'reason': 'stopped_or_expired_before_dispatch'})
            current = self._active(row)
            active = current['active']
            active.update(childId=child['id'], phase='submitting')
            self._put(current, ('cluster-run', child), (ROUND, {**self.store.get(ROUND, active['id']), **active}))
        try:
            self.service.clusters.submit(child['id'], managed=self._dispatch_token, timeout=min(90, self._remaining(row)))
        except (PermissionError, ValueError, OSError):
            # The existing cluster submission path commits its own durable
            # unknown reservation before invoking the real scheduler.
            stored = self.service.clusters.raw(child['id'])
            if stored.get('submit_attempted'):
                self._finish(row, {'status': 'unknown', 'childId': child['id'], 'reason': 'submission_unconfirmed'}, retain_child=True)
                return
            self.service.clusters.merge(child['id'], status='failed', error='Managed child did not reach submission')
            raise
        with self.store.lock:
            current = self._active(row)
            stored = self.service.clusters.raw(child['id'])
            if stored['status'] == 'unknown':
                self._finish(row, {'status': 'unknown', 'childId': child['id'], 'reason': 'submission_unconfirmed'}, retain_child=True)
                return
            active = current['active']
            active.update(phase='watching', jobId=stored['job_id'], status=stored['status'],
                          nextCheckAt=min(active['deadlineAt'], self.clock() + CHILD_OBSERVATION_SECONDS))
            self._put(current, (ROUND, {**self.store.get(ROUND, active['id']), **active, 'status': stored['status']}))

    def _execute(self, row):
        try:
            if not self._dispatchable(row):
                self._finish(row, {'status': 'skipped', 'reason': 'stopped_or_expired_before_dispatch'})
                return
            parent, _ = project_parent(self.service, row['scope'], row['parent'])
            if row['kind'] == 'script':
                self._submit_child(row, parent)
            else:
                result = self._observe_round(row, parent)
                if self.clock() >= row['active']['deadlineAt']:
                    result = {'status': 'timed_out', 'reason': 'control_action_deadline'}
                self._finish(row, result)
        except (PermissionError, ValueError, KeyError):
            self._finish(row, {'status': 'blocked', 'reason': 'authorized_target_or_action_unavailable'})
        except Exception:
            current = self._active(row)
            linked = current and current['active'].get('childId')
            retain = bool(linked and self.service.clusters.raw(linked).get('submit_attempted'))
            self._finish(row, {'status': 'unknown', 'reason': 'execution_unconfirmed'}, retain_child=retain)
        finally:
            with self.store.lock:
                self._dispatching.discard(row['active']['id'])
                current = self._active(row)
            if current and current['stopRequestedAt'] is not None:
                self._cancel_active(current)

    def _cancel_active(self, owned, *, timed_out=False):
        with self.store.lock:
            row = self._active(owned)
            if not row:
                return
            active = row['active']
            if active['id'] in self._dispatching or active.get('cancelAttemptedAt') is not None:
                return
            cancellation = {'status': 'not_needed', 'childId': active['childId'], 'signalSent': False}
            if not active['childId']:
                return self._finish(row, {'status': 'skipped', 'reason': 'stopped_before_child_submission'}, cancellation=cancellation)
            child = self.service.clusters.raw(active['childId'])
            if child['status'] in TERMINAL_JOBS or not child.get('submit_attempted'):
                return self._finish(row, {'status': child['status'] if child['status'] in TERMINAL_JOBS else 'skipped',
                                          'childId': child['id'], 'run': project_run(child)}, cancellation=cancellation)
            active.update(phase='cancel_claimed', cancelAttemptedAt=self.clock(), nextCheckAt=None)
            cancellation.update(status='unconfirmed', signalSent=None)
            row['cancellation'] = cancellation
            self._put(row, (ROUND, {**self.store.get(ROUND, active['id']), **active}))
        try:
            self.service.clusters.cancel(child['id'], managed=self._cancel_token, timeout=12)
        except Exception:
            pass
        child = self.service.clusters.raw(child['id'])
        if child['status'] in TERMINAL_JOBS:
            cancellation.update(status='confirmed' if child['status'] == 'cancelled' else 'not_needed',
                                signalSent=(child.get('cancellation') or {}).get('signal_sent'))
            return self._finish(row, {'status': 'timed_out' if timed_out else child['status'], 'childId': child['id'],
                                      'run': project_run(child)}, cancellation=cancellation)
        signal = (child.get('cancellation') or {}).get('signal_sent')
        cancellation.update(status='unconfirmed', signalSent=signal)
        if signal is True:
            with self.store.lock:
                current = self._active(row)
                active = current['active']
                active.update(phase='verify_cancel', nextCheckAt=self.clock() + 5, timedOut=timed_out)
                current['cancellation'] = {**cancellation, 'status': 'requested'}
                self._put(current, (ROUND, {**self.store.get(ROUND, active['id']), **active}))
                return
        self._finish(row, {'status': 'unknown', 'reason': 'timeout_unconfirmed' if timed_out else 'cancellation_unconfirmed',
                           'childId': child['id'], 'run': project_run(child)}, retain_child=True, cancellation=cancellation)

    def _verify_cancellation(self, row):
        active = row['active']
        # No second signal. A lost confirmation leaves the exact child record
        # and reports uncertainty, including across a worker restart.
        with self.store.lock:
            current = self._active(row)
            current['active'].update(phase='verify_cancel_claimed', nextCheckAt=None)
            current['cancellation'] = {**current['cancellation'], 'status': 'unconfirmed'}
            self._put(current)
        clusters = self.service.clusters
        try:
            clusters.poll(active['childId'], managed=self._cancel_token, timeout=12)
        except Exception:
            pass
        child = clusters.raw(active['childId'])
        status = child['status']
        cancellation = {**row['cancellation'], 'status': 'unconfirmed'}
        if status in TERMINAL_JOBS:
            cancellation['status'] = 'confirmed' if status == 'cancelled' else 'finished'
            return self._finish(row, {'status': 'timed_out' if active['timedOut'] else status,
                                      'run': project_run(child), 'childId': child['id']}, cancellation=cancellation)
        self._finish(row, {'status': 'unknown', 'reason': 'cancellation_unconfirmed',
                           'run': project_run(child), 'childId': child['id']}, retain_child=True, cancellation=cancellation)

    def stop(self, data):
        fields(data, ('sourceId', 'scheduleId'), ('sourceId', 'scheduleId'))
        source = identifier(data['sourceId'])
        with self.store.lock:
            row = self._read(source, data['scheduleId'])
            active = row['active']
            if row['stopRequestedAt'] is None:
                state = 'requested' if active else 'not_needed'
                row.update(status='stopped', stopRequestedAt=self.clock(),
                           cancellation=row['cancellation'] or {'status': state, 'signalSent': False, 'childId': active and active['childId']})
                pending = [(DELIVERY, {**event, 'state': 'suppressed'}) for event in self._pending(source)
                           if event['scheduleId'] == row['id']]
                self._put(row, *pending)
        if active:
            self._cancel_active(row)
        return self._public(self._read(source, row['id']))

    def _maintain(self, row):
        active, now = row['active'], self.clock()
        if active['phase'] == 'verify_cancel':
            return self._verify_cancellation(row)
        if row['stopRequestedAt'] is not None:
            return self._cancel_active(row)
        if active['phase'] == 'dispatching' or not active['childId']:
            self._finish(row, {'status': 'unknown', 'reason': 'interrupted_round'})
            return
        child = self.service.clusters.raw(active['childId'])
        if child['status'] not in ACTIVE_JOBS and child['status'] not in TERMINAL_JOBS:
            self._finish(row, {'status': 'unknown', 'reason': 'interrupted_child_submission', 'childId': child['id']},
                         retain_child=bool(child.get('submit_attempted')))
            return
        if child['status'] in ACTIVE_JOBS and now >= active['deadlineAt']:
            return self._cancel_active(row, timed_out=True)
        if child['status'] in ACTIVE_JOBS:
            try:
                self.service.clusters.poll(child['id'], managed=self._poll_token, timeout=min(40, self._remaining(row)))
                child = self.service.clusters.raw(active['childId'])
            except Exception:
                self._finish(row, {'status': 'unknown', 'reason': 'child_observation_unavailable', 'childId': child['id']},
                             retain_child=True)
                return
        with self.store.lock:
            current = self._active(row)
            if current is None or current['stopRequestedAt'] is not None:
                return
            if child['status'] not in ACTIVE_JOBS:
                result = {'status': child['status'], 'childId': child['id'], 'run': project_run(child), 'exit': child.get('exit')}
                self._finish(row, result, retain_child=child['status'] == 'unknown')
            else:
                current['active'].update(phase='watching', jobId=child['job_id'], status=child['status'],
                                         nextCheckAt=min(active['deadlineAt'], self.clock() + CHILD_OBSERVATION_SECONDS))
                self._put(current, (ROUND, {**self.store.get(ROUND, active['id']), **current['active'], 'status': child['status']}))

    def _pending(self, source):
        return sorted((event for event in self.store.list(DELIVERY) if event['sourceId'] == source and event['state'] == 'pending'),
                      key=lambda item: (item['dueAt'], item['id']))

    def ack(self, data):
        fields(data, ('sourceId', 'deliveryId'), ('sourceId', 'deliveryId'))
        source = identifier(data['sourceId'])
        with self.store.lock:
            event = self.store.get(DELIVERY, identifier(data['deliveryId']))
            if event['sourceId'] != source:
                raise PermissionError('Notification belongs to the original worker source')
            if event['state'] == 'pending':
                self.store.put(DELIVERY, {**event, 'state': 'accepted', 'acceptedAt': self.clock()})
            return {'id': event['id']}

    @staticmethod
    def _task_scope(row):
        return tuple(row['scope'][key] for key in ('provider', 'threadId', 'taskId', 'projectId'))

    def _skip_missed(self, source, skip):
        now = self.clock()
        with self.store.lock:
            for row in self._rows(source):
                if row['id'] not in skip and row['status'] == 'scheduled' and row['nextAt'] <= now:
                    self._advance(row, now)
                    self._schedule_state(row, now)
                    self._put(row)

    def _step(self, source, skip):
        now = self.clock()
        with self.store.lock:
            schedules = self._rows(source)
            candidates = []
            busy = {self._task_scope(row) for row in schedules if row['active']}
            for row in schedules:
                active = row['active']
                if row['id'] in skip:
                    continue
                if active:
                    if active['nextCheckAt'] is not None and active['nextCheckAt'] <= now:
                        candidates.append((active['nextCheckAt'], row['id'], row))
                    continue
                status = row['status']
                self._schedule_state(row, now)
                if status != row['status']:
                    self._put(row)
                if row['status'] == 'scheduled' and row['nextAt'] <= now and self._task_scope(row) not in busy:
                    candidates.append((row['nextAt'], row['id'], row))
            if not candidates:
                return
            _, _, row = min(candidates)
            maintain = row['active'] is not None
            if not maintain:
                self._claim(row, now)
                self._dispatching.add(row['active']['id'])
        if maintain:
            self._maintain(row)
        else:
            self._execute(row)

    def pump(self, data):
        fields(data, ('sourceId', 'resume', 'skipScheduleIds'), ('sourceId',))
        source = identifier(data['sourceId'])
        resume, skip = data.get('resume', False), data.get('skipScheduleIds', [])
        if type(resume) is not bool or not isinstance(skip, list) or len(skip) > 1024:
            raise ValueError('Invalid desktop dispatch control')
        skip = {identifier(value) for value in skip}
        if resume:
            self._skip_missed(source, skip)
        if self._pump_lock.acquire(blocking=False):
            try:
                self._step(source, skip)
            finally:
                self._pump_lock.release()
        with self.store.lock:
            view = self.snapshot({'sourceId': source})
            pending = [event for event in self._pending(source) if event['scheduleId'] not in skip]
            view['deliveries'] = [{key: value for key, value in event.items() if key != 'state'} for event in pending[:64]]
            return view

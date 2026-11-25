"""Report a run action rejected before reservation or job dispatch."""
from contextlib import contextmanager


@contextmanager
def run_preflight():
    try:
        yield
    except Exception as error:
        error.run_operation_not_started = True
        raise


def rejection_receipt(error):
    if getattr(error, 'run_operation_not_started', False) is not True:
        return None
    from studio_worker.compute.ssh_auth import AuthError
    if isinstance(error, AuthError):
        return {'status': 'needs_human_auth', 'code': 'needs_human_auth',
                'message': 'Open private authentication for the original saved connection.',
                'operation_state': 'not_started', 'automatic_retry': False,
                'next_step': 'Authenticate the original saved connection before an explicit submission of this prepared draft.'}
    code = ('access_required' if isinstance(error, PermissionError) else 'invalid_input'
            if isinstance(error, (ValueError, KeyError, TypeError)) else 'run_preflight_failed')
    return {'status': 'blocked', 'code': code, 'message': str(error)[:4000],
            'operation_state': 'not_started', 'automatic_retry': False,
            'next_step': 'Address the reported condition on the original authorized target before another explicit run action.'}

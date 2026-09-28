from hypothesis import HealthCheck, settings

settings.register_profile("mutation", suppress_health_check=[HealthCheck.too_slow], deadline=None)
